/**
 * RunActivityTracker — live turn / tool stats for the top border.
 * Adapted from pi-atelier's run-activity.ts for pi-skill-desc.
 * Tracks: turn number, turn duration, tool calls, failed tool calls.
 * Notifies on every change so the border can refresh in real time.
 */

export type RunPhase = "idle" | "running" | "settled";

export interface RunActivitySnapshot {
  phase: RunPhase;
  turnNumber?: number;
  startedAt?: number;
  durationMs?: number;
  activeTools: number;
  completedCount: number;
  failedCount: number;
}

export interface RunActivityTrackerOptions {
  now?: () => number;
  onChange?: (snap: RunActivitySnapshot) => void;
}

function normalizeTimestamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.trunc(v));
}

export function createRunActivityTracker(opts: RunActivityTrackerOptions = {}): RunActivityTracker {
  return new DefaultRunActivityTracker(opts);
}

export interface RunActivityTracker {
  startRun(now?: number): void;
  startTurn(turnIndex: number, now?: number): void;
  startTool(toolCallId: string, now?: number): void;
  /**
   * Consume one tool call's outcome. pi reports the SAME call on two channels
   * (`tool_execution_end` and the `tool_result` extension event) and nested calls
   * (`<parent>/<n>`) on both too, so the first report owns the count: true when this id was
   * newly finished in this run, false for a re-delivery of a call already counted.
   */
  finishTool(toolCallId: string, isError: boolean, now?: number): boolean;
  settle(now?: number): void;
  reset(): void;
  getSnapshot(now?: number): RunActivitySnapshot;
  isRunning(): boolean;
}

class DefaultRunActivityTracker implements RunActivityTracker {
  private phase: RunPhase = "idle";
  private turnNumber: number | undefined;
  private startedAt: number | undefined;
  private durationMs: number | undefined;
  private activeTools = new Map<string, number>();
  /**
   * Tool call ids whose outcome this run already counted — the one outcome key. pi emits one
   * execution on two channels, so without it the second channel counts a second tool.
   * Cleared with the run (startRun / reset): a later run's ids are its own.
   */
  private finishedTools = new Set<string>();
  private completedCount = 0;
  private failedCount = 0;
  private readonly now: () => number;
  private readonly onChange?: (snap: RunActivitySnapshot) => void;

  constructor(opts: RunActivityTrackerOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.onChange = opts.onChange;
  }

  startRun(now?: number): void {
    this.phase = "running";
    this.turnNumber = undefined;
    this.startedAt = normalizeTimestamp(now ?? this.now());
    this.durationMs = undefined;
    this.activeTools = new Map();
    this.finishedTools = new Set();
    this.completedCount = 0;
    this.failedCount = 0;
    this.notify();
  }

  startTurn(turnIndex: number, now?: number): void {
    const nextTurn = Math.max(0, Number.isFinite(turnIndex) ? Math.trunc(turnIndex) : 0) + 1;
    // avoid double-fire for same turn
    if (this.turnNumber === nextTurn && this.phase === "running") return;
    this.phase = "running";
    this.turnNumber = nextTurn;
    // if no startedAt yet (no agent_start), start now
    if (this.startedAt === undefined) this.startedAt = normalizeTimestamp(now ?? this.now());
    this.durationMs = undefined;
    this.notify();
  }

  startTool(toolCallId: string, now?: number): void {
    if (!toolCallId) return;
    this.phase = "running";
    if (this.startedAt === undefined) this.startedAt = normalizeTimestamp(now ?? this.now());
    this.durationMs = undefined;
    this.activeTools.set(toolCallId, normalizeTimestamp(now ?? this.now()));
    this.notify();
  }

  finishTool(toolCallId: string, isError: boolean, now?: number): boolean {
    // One call, one outcome: pi's other channel for this execution is not a second tool.
    if (this.finishedTools.has(toolCallId)) return false;
    this.finishedTools.add(toolCallId);
    // An id that was never active means the start event was missed — still count the call.
    this.activeTools.delete(toolCallId);
    if (isError) this.failedCount += 1;
    else this.completedCount += 1;
    void now; // duration per-tool not needed for top border
    this.notify();
    return true;
  }

  settle(now?: number): void {
    if (this.phase === "idle" && this.activeTools.size === 0) return;
    if (this.phase === "settled" && this.activeTools.size === 0) return;
    const settledAt = normalizeTimestamp(now ?? this.now());
    // any still-active tools count as failed
    for (const toolCallId of this.activeTools.keys()) {
      this.failedCount += 1;
      // Settled-but-late duplicate of the same call must not count twice either.
      this.finishedTools.add(toolCallId);
    }
    this.activeTools.clear();
    this.phase = "settled";
    this.durationMs = Math.max(0, settledAt - (this.startedAt ?? settledAt));
    this.notify();
  }

  reset(): void {
    if (
      this.phase === "idle" &&
      this.turnNumber === undefined &&
      this.startedAt === undefined &&
      this.durationMs === undefined &&
      this.activeTools.size === 0 &&
      this.finishedTools.size === 0 &&
      this.completedCount === 0 &&
      this.failedCount === 0
    )
      return;
    this.phase = "idle";
    this.turnNumber = undefined;
    this.startedAt = undefined;
    this.durationMs = undefined;
    this.activeTools.clear();
    this.finishedTools.clear();
    this.completedCount = 0;
    this.failedCount = 0;
    this.notify();
  }

  isRunning(): boolean {
    return this.phase === "running";
  }

  getSnapshot(now?: number): RunActivitySnapshot {
    const cur = normalizeTimestamp(now ?? this.now());
    let duration: number | undefined = this.durationMs;
    if (duration === undefined && this.startedAt !== undefined && this.phase === "running") {
      duration = Math.max(0, cur - this.startedAt);
    }
    return Object.freeze({
      phase: this.phase,
      ...(this.turnNumber === undefined ? {} : { turnNumber: this.turnNumber }),
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      ...(duration === undefined ? {} : { durationMs: duration }),
      activeTools: this.activeTools.size,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
    });
  }

  private notify(): void {
    this.onChange?.(this.getSnapshot());
  }
}

// Formatting for top border — theme-aware
export function formatRunActivityTopRight(
  snap: RunActivitySnapshot,
  theme: { fg(style: string, s: string): string },
  now?: number,
): string {
  if (snap.phase === "idle" && snap.turnNumber === undefined) return "";

  const parts: string[] = [];

  // turn
  if (snap.turnNumber !== undefined) {
    parts.push(theme.fg("accent", `${snap.turnNumber} turns`));
  } else if (snap.phase === "running") {
    parts.push(theme.fg("accent", `1 turns`));
  }

  // duration
  const dur =
    snap.durationMs ??
    (snap.startedAt === undefined ? undefined : Math.max(0, (now ?? Date.now()) - snap.startedAt));
  if (dur !== undefined) {
    parts.push(theme.fg("text", formatDurationShort(dur)));
  }

  // tool counts — show active + completed
  const totalTools = snap.completedCount + snap.failedCount + snap.activeTools;
  if (totalTools > 0 || snap.phase !== "idle") {
    const toolText =
      snap.activeTools > 0
        ? `${totalTools} tools (${snap.activeTools} running)`
        : `${totalTools} tools`;
    parts.push(theme.fg(snap.failedCount > 0 ? "warning" : "muted", toolText));
  }

  // failed
  if (snap.failedCount > 0) {
    parts.push(theme.fg("error", `${snap.failedCount} failed`));
  }

  if (parts.length === 0) return "";
  return parts.join(theme.fg("dim", " · "));
}

function formatDurationShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${String(sec).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${String(rm).padStart(2, "0")}m`;
}

export function formatRunActivityPlain(snap: RunActivitySnapshot, now?: number): string {
  // plain (no ANSI) for tests
  const dummy = { fg: (_: string, s: string) => s };
  return formatRunActivityTopRight(snap, dummy as never, now).replace(/\x1b\[[0-9;]*m/g, "");
}
