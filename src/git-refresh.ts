import type { GitStatus } from "./git.js";

/**
 * The one owner of *when* the footer's git rail is re-read.
 *
 * pi's `FooterDataProvider` notifies `onBranchChange` only when the resolved branch
 * string changes (it compares `cachedBranch !== nextBranch`), so committing, adding,
 * stashing or going `ahead` on the same branch fires no event at all. Wired to that
 * alone the rail pins whatever it read at install time and drifts from `git status`
 * for the rest of the session (see AGENTS.md "Git rail refresh").
 *
 * Refresh is event-driven on purpose: an agent run settling is the moment the rail
 * can have changed, and it is the moment the user looks. A timer would trade spawns
 * per second for latency nobody asked for, so there is none — the lag is exactly one
 * event, and an out-of-band `git add` in another terminal waits for the next settle.
 *
 * Requests still coalesce: one read in flight plus one trailing read, and requests
 * inside `GIT_MIN_GAP_MS` share the read already made for the first one.
 */

/** Requests inside this window share the read already made for the first one. */
export const GIT_MIN_GAP_MS = 500;

export interface GitRailSnapshot {
  /** `null` means "could not answer" — the caller keeps its last known rail. */
  readonly status: GitStatus | null;
  /** In-progress operation label (`MERGING`, `REBASE 2/7`); empty when none runs. */
  readonly action: string;
}

export interface GitRefresherDeps {
  readonly read: () => Promise<GitRailSnapshot>;
  /** Commit a snapshot; `true` when the rail actually changed and needs a repaint. */
  readonly apply: (snapshot: GitRailSnapshot) => boolean;
  readonly render: () => void;
  readonly minGapMs?: number;
  /** Clock seam — tests drive the min-gap window without sleeping. */
  readonly now?: () => number;
}

/** What the orchestrator needs from the rail clock — a test can pass a plain fake. */
export interface GitRailClock {
  start(): void;
  stop(): void;
  request(): void;
}

export class GitRefresher implements GitRailClock {
  private active = false;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private pending = false;
  private lastReadMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: GitRefresherDeps) {}

  /** Arm the latch and take the first read. Idempotent. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.request();
  }

  /** Disarm. A read already in flight still lands (it only refreshes state). */
  stop(): void {
    this.active = false;
    if (this.trailing !== null) {
      clearTimeout(this.trailing);
      this.trailing = null;
    }
    this.pending = false;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Ask for a fresh rail. No-ops while disarmed, so a detached footer never spawns
   * git; while armed, the request coalesces instead of queueing.
   */
  request(): void {
    if (!this.active) return;
    this.runOrDefer();
  }

  private runOrDefer(): void {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    const wait = this.minGapMs() - (this.now() - this.lastReadMs);
    if (wait > 0) {
      this.defer(wait);
      return;
    }
    void this.read();
  }

  private defer(wait: number): void {
    this.pending = true;
    if (this.trailing !== null) return;
    this.trailing = setTimeout(() => {
      this.trailing = null;
      this.pending = false;
      this.runOrDefer();
    }, wait);
    this.trailing.unref?.();
  }

  private async read(): Promise<void> {
    this.inFlight = true;
    this.lastReadMs = this.now();
    try {
      const snapshot = await this.deps.read();
      if (this.deps.apply(snapshot)) this.deps.render();
    } catch {
      // Best-effort chrome: a failed read leaves the last known rail in place.
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        this.runOrDefer();
      }
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private minGapMs(): number {
    return this.deps.minGapMs ?? GIT_MIN_GAP_MS;
  }
}
