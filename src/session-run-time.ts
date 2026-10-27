/**
 * SessionRunTime — deep module owning the session's cumulative agent-run wall time.
 *
 * One question ("how long has this session actually run?") previously had no home:
 * the orchestrator computed per-run `lastDoneIn` and threw it away at the next
 * `agent_start`. This module accumulates those deltas (same measure, tool time
 * included, idle time between runs excluded) behind one seam, so the top-rule
 * field, the restore-on-resume and the per-settle persistence entry all read one
 * state.
 *
 * Persistence is a dedicated custom session entry (`pi.appendEntry`, same seam as
 * the timeline) storing CUMULATIVE seconds — the LAST entry wins on restore, and
 * the append is unconditional: the data layer never consults the display toggle.
 */

import type { SessionEntryLike } from "./session-entries.js";

/** Custom-entry type this module persists under — one entry per `agent_settled`. */
export const SESSION_RUN_TIME_ENTRY_TYPE = "session-run-time";

/** Payload of a `session-run-time` custom entry: cumulative seconds, not a delta. */
export interface SessionRunTimeEntryData {
  seconds: number;
}

/** What a display seam reads: the live total and whether it is still growing. */
export interface SessionRunTimeSnapshot {
  /** Settled accumulation + in-flight elapsed (ms) — the value the field renders. */
  totalMs: number;
  /** True while an agent run is in flight (totalMs grows on every read). */
  running: boolean;
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
  private accumulatedMs = 0;
  private runStartMs: number | null = null;

  /** Seed from session history — replaces any prior state (this IS the session_start reset). */
  restoreFromEntries(entries: readonly unknown[] | undefined): void {
    this.accumulatedMs = restoreSessionRunTimeMs(entries);
    this.runStartMs = null;
  }

  /** `agent_start` — mark the in-flight run. Mirrors the orchestrator's `agentStartMs`. */
  startRun(now: number): void {
    this.runStartMs = now;
  }

  /**
   * `agent_settled` — fold the in-flight run into the accumulation. No-op when no
   * run is live, so a stray second settle cannot double-count.
   */
  settleRun(now: number): void {
    if (this.runStartMs === null) return;
    this.accumulatedMs += Math.max(0, now - this.runStartMs);
    this.runStartMs = null;
  }

  /** Settled accumulation only — what a persistence entry stores (floor to seconds at the writer). */
  settled(): number {
    return this.accumulatedMs;
  }

  /** Display snapshot: static at the settled value between runs, growing while a run is live. */
  snapshot(now: number = Date.now()): SessionRunTimeSnapshot {
    const running = this.runStartMs !== null;
    return {
      totalMs: this.accumulatedMs + (running ? Math.max(0, now - (this.runStartMs as number)) : 0),
      running,
    };
  }
}
