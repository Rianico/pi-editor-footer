/**
 * SessionRunTime — deep module owning the session's cumulative wall time.
 *
 * One question ("how long has this session actually run?") previously had no home:
 * the orchestrator computed per-run `lastDoneIn` and threw it away at the next
 * `agent_start`. This module accumulates those deltas (same measure, tool time
 * included, idle time between runs excluded) behind one seam, so the top-rule
 * field, the restore-on-resume and the per-settle persistence entry all read one
 * state.
 *
 * Delegated work extends that measure without breaking it: a background child runs
 * while the parent is idle, so its `subagent:async-started` → `subagent:async-complete`
 * window is another live interval. The accumulation is the UNION of every interval,
 * never a sum — two children running at once (or a foreground child inside the parent
 * run) cost the wall clock once, and a foreground delegation therefore leaves the
 * figure untouched.
 *
 * Persistence is a dedicated custom session entry (`pi.appendEntry`, same seam as
 * the timeline) storing CUMULATIVE seconds — the LAST entry wins on restore, and
 * the append is unconditional: the data layer never consults the display toggle.
 * Only CLOSED intervals are persisted, so an in-flight run is never counted twice
 * after a resume.
 */

import type { SessionEntryLike } from "./session-entries.js";

/** Custom-entry type this module persists under — one entry per settle. */
export const SESSION_RUN_TIME_ENTRY_TYPE = "session-run-time";

/** Payload of a `session-run-time` custom entry: cumulative seconds, not a delta. */
export interface SessionRunTimeEntryData {
  seconds: number;
}

/** What a display seam reads: the live total and whether it is still growing. */
export interface SessionRunTimeSnapshot {
  /** Union of the parent run and every delegated child (ms) — includes children unless asked not to. */
  totalMs: number;
  /** True while an agent run is in flight (totalMs grows on every read). */
  running: boolean;
}

/** Display options — the `subagentUsage` toggle decides whether child intervals count. */
export interface SessionRunTimeSnapshotOptions {
  /** Fold `subagent:async-*` child intervals into `totalMs`. Defaults to true. */
  includeSubagent?: boolean;
}

/** Half-open wall-clock interval. */
interface Interval {
  startMs: number;
  endMs: number;
}

/** An interval tagged with its owner — the parent run, or one delegated child run. */
interface OwnedInterval extends Interval {
  id: string;
}

/** Owner id of the parent run's interval — children carry their own run id. */
const PARENT_INTERVAL = "parent";

/** Length of the union of `intervals` — overlap counted once, not summed. */
function unionMs(intervals: readonly Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let cursorStart = sorted[0]!.startMs;
  let cursorEnd = sorted[0]!.endMs;
  for (const interval of sorted.slice(1)) {
    if (interval.startMs <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, interval.endMs);
      continue;
    }
    total += cursorEnd - cursorStart;
    cursorStart = interval.startMs;
    cursorEnd = interval.endMs;
  }
  return total + (cursorEnd - cursorStart);
}

/**
 * Restore the accumulator from session history: the LAST `session-run-time`
 * entry wins (each stores cumulative seconds). Entries of other types are
 * skipped; a history without the entry (fresh session) restores 0.
 */
export function restoreSessionRunTimeMs(entries: readonly unknown[] | undefined): number {
  if (!entries) return 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    const e = entries[i] as Partial<SessionEntryLike> & {
      customType?: string;
      data?: Partial<SessionRunTimeEntryData>;
    }; // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    if (e?.type !== "custom" || e.customType !== SESSION_RUN_TIME_ENTRY_TYPE) continue;
    const seconds = e.data?.seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    return 0;
  }
  return 0;
}

export class SessionRunTimeAccumulator {
  /** Restored union from history (all of it in the past) — merged after, never re-opened. */
  private baseMs = 0;
  /** Intervals closed this session, parent and delegated alike — the id survives the close. */
  private closed: OwnedInterval[] = [];
  /** Open intervals by owner id — the parent run and any live delegated child. */
  private open = new Map<string, number>();

  /**
   * Seed from session history — replaces any prior state (this IS the session_start
   * reset). Live intervals are dropped: an interrupted run cannot be measured.
   */
  restoreFromEntries(entries: readonly unknown[] | undefined): void {
    this.baseMs = restoreSessionRunTimeMs(entries);
    this.closed = [];
    this.open = new Map();
  }

  /** `agent_start` — mark the in-flight run. Mirrors the orchestrator's `agentStartMs`. */
  startRun(now: number): void {
    if (!this.open.has(PARENT_INTERVAL)) this.open.set(PARENT_INTERVAL, now);
  }

  /**
   * `agent_settled` — fold the in-flight run into the accumulation. No-op when no
   * run is live, so a stray second settle cannot double-count.
   */
  settleRun(now: number): void {
    this.close(PARENT_INTERVAL, now);
  }

  /** `subagent:async-started` — a delegated child is live; its window joins the union. */
  startSubagent(id: string, now: number): void {
    if (!this.open.has(id)) this.open.set(id, now);
  }

  /**
   * `subagent:async-complete` — close that child's window. Unknown ids are a no-op;
   * the return value says whether a window actually closed (a settle owes a persist).
   */
  settleSubagent(id: string, now: number): boolean {
    return this.close(id, now);
  }

  /** True while any interval (parent or child) is live — the display tick's stop condition. */
  hasLiveInterval(): boolean {
    return this.open.size > 0;
  }

  /**
   * Settled accumulation only — what a persistence entry stores (floor to seconds at
   * the writer). Children count, but only their CLOSED windows: persisting a live
   * parent window would double-count it when the run later settles.
   */
  settled(): number {
    return this.baseMs + unionMs(this.closed);
  }

  /**
   * Display snapshot: static at the settled value between runs, growing while a run is
   * live. `includeSubagent: false` answers the parent-only question — the same figure a
   * session without the subagent integration shows.
   */
  snapshot(
    now: number = Date.now(),
    options: SessionRunTimeSnapshotOptions = {},
  ): SessionRunTimeSnapshot {
    const includeSubagent = options.includeSubagent !== false;
    const intervals: Interval[] = this.closed.filter(
      (interval) => includeSubagent || interval.id === PARENT_INTERVAL,
    );
    for (const [id, startMs] of this.open) {
      if (!includeSubagent && id !== PARENT_INTERVAL) continue;
      intervals.push({ startMs, endMs: Math.max(startMs, now) });
    }
    return {
      totalMs: this.baseMs + unionMs(intervals),
      running: this.open.has(PARENT_INTERVAL),
    };
  }

  private close(id: string, now: number): boolean {
    const startMs = this.open.get(id);
    if (startMs === undefined) return false;
    this.open.delete(id);
    if (now > startMs) this.closed.push({ id, startMs, endMs: now });
    return true;
  }
}
