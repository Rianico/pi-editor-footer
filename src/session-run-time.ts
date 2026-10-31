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
 *
 * Both scopes are persisted: `seconds` (inclusive) AND `parentSeconds` (parent-only),
 * because the restored inclusive total cannot be split back into its parts. An entry
 * written before that pair existed falls back to the inclusive figure for both — the
 * honest answer, since the split is simply not in the history.
 */

import type { SessionEntryLike } from "./session-entries.js";

/** Custom-entry type this module persists under — one entry per settle. */
export const SESSION_RUN_TIME_ENTRY_TYPE = "session-run-time";

/** Payload of a `session-run-time` custom entry: cumulative seconds, not a delta. */
export interface SessionRunTimeEntryData {
  /** Union of the parent run and every delegated child (the toggle-on figure). */
  seconds: number;
  /**
   * Parent-only union (the toggle-off figure). Absent on entries written before the
   * delegated integration existed; a reader then falls back to `seconds`.
   */
  parentSeconds?: number;
}

/** Both restored cumulative scopes — the run-time field renders one of them. */
export interface SessionRunTimeScopes {
  /** Inclusive of delegated children — the `subagentUsage` on figure. */
  totalMs: number;
  /** Parent runs only — the `subagentUsage` off figure. */
  parentMs: number;
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

/** A usable cumulative seconds value: a finite, non-negative number. */
function cumulativeSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Restore both scopes from session history: the LAST USABLE `session-run-time` entry
 * wins (each stores cumulative seconds). A malformed entry — a truncated write, a
 * payload from a future schema — is skipped rather than treated as "this session never
 * ran", so a corrupt tail cannot erase a valid history behind it. Entries of other
 * types are skipped; a history without a usable entry (fresh session) restores 0.
 *
 * An entry without `parentSeconds` predates the delegated integration: the split is not
 * in the history, so the inclusive figure answers both questions.
 */
export function restoreSessionRunTimeScopes(
  entries: readonly unknown[] | undefined,
): SessionRunTimeScopes {
  if (!entries) return { totalMs: 0, parentMs: 0 };
  for (let i = entries.length - 1; i >= 0; i--) {
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    const e = entries[i] as Partial<SessionEntryLike> & {
      customType?: string;
      data?: Partial<SessionRunTimeEntryData>;
    }; // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    if (e?.type !== "custom" || e.customType !== SESSION_RUN_TIME_ENTRY_TYPE) continue;
    const seconds = cumulativeSeconds(e.data?.seconds);
    if (seconds === undefined) continue;
    const parentSeconds = cumulativeSeconds(e.data?.parentSeconds) ?? seconds;
    return { totalMs: seconds * 1000, parentMs: parentSeconds * 1000 };
  }
  return { totalMs: 0, parentMs: 0 };
}

/** Inclusive restore — the single number callers that do not render a scope need. */
export function restoreSessionRunTimeMs(entries: readonly unknown[] | undefined): number {
  return restoreSessionRunTimeScopes(entries).totalMs;
}

export class SessionRunTimeAccumulator {
  /** Restored inclusive union from history (all of it in the past) — merged after, never re-opened. */
  private baseMs = 0;
  /** Restored parent-only union — the toggle-off base (not derivable from `baseMs`). */
  private baseParentMs = 0;
  /** Intervals closed this session, parent and delegated alike — the id survives the close. */
  private closed: OwnedInterval[] = [];
  /** Open intervals by owner id — the parent run and any live delegated child. */
  private open = new Map<string, number>();

  /**
   * Seed from session history — replaces any prior state (this IS the session_start
   * reset). Live intervals are dropped: an interrupted run cannot be measured.
   */
  restoreFromEntries(entries: readonly unknown[] | undefined): void {
    const scopes = restoreSessionRunTimeScopes(entries);
    this.baseMs = scopes.totalMs;
    this.baseParentMs = scopes.parentMs;
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
   * Parent-only settled accumulation — the value persisted as `parentSeconds`, so a
   * resumed session can still answer the toggle-off question.
   */
  settledParent(): number {
    return (
      this.baseParentMs + unionMs(this.closed.filter((interval) => interval.id === PARENT_INTERVAL))
    );
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
      totalMs: (includeSubagent ? this.baseMs : this.baseParentMs) + unionMs(intervals),
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
