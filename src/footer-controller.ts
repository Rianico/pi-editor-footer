import { readGitStatus } from "./git.js";
import { readRuntimeInfo } from "./runtime.js";
import { createInitialState } from "./state.js";
import type { FooterState } from "./state.js";

/**
 * FooterController — deep module owning FooterState + git/runtime polling behind one seam.
 * Previously FooterState lived in index.ts and callers had to orchestrate readGitStatus/readRuntimeInfo
 * and merge into state. Now all that hides behind Controller.
 *
 * Interface is the test surface: new FooterController({ getCwd }) → { getState, refresh, setWorking, setDone }
 * The rendering adapter (setFooter vs setWidget) is also hidden inside install path (two adapters → real seam).
 */
export class FooterController {
  private state: FooterState = createInitialState();
  private readonly getCwd: () => string;

  constructor(opts: { getCwd: () => string; initialState?: FooterState }) {
    this.getCwd = opts.getCwd;
    if (opts.initialState) this.state = opts.initialState;
  }

  getState(): FooterState {
    return this.state;
  }

  setWorking(since: number | undefined): void {
    this.state = {
      ...this.state,
      workingSince: since,
      lastDoneIn: since === undefined ? this.state.lastDoneIn : undefined,
    };
  }

  setDone(doneIn: number | undefined): void {
    this.state = { ...this.state, lastDoneIn: doneIn, workingSince: undefined };
  }

  async refreshGit(): Promise<void> {
    try {
      const cwd = this.getCwd();
      const git = await readGitStatus(cwd);
      this.state = { ...this.state, git };
    } catch {
      // best-effort
    }
  }

  async refreshRuntime(): Promise<void> {
    try {
      const cwd = this.getCwd();
      const runtime = await readRuntimeInfo(cwd);
      this.state = { ...this.state, runtime };
    } catch {
      // best-effort
    }
  }

  async refreshAll(): Promise<void> {
    await this.refreshGit();
    await this.refreshRuntime();
  }
}

/**
 * createFooter — deep public factory.
 * Owns polling and state; callers supply only getCwd/getConfig/getContextUsage.
 * Keeps renderFooter pure as internal seam.
 */
export function createFooter(opts: { getCwd: () => string }) {
  const ctrl = new FooterController({ getCwd: opts.getCwd });
  return {
    controller: ctrl,
    getState: () => ctrl.getState(),
    refresh: () => ctrl.refreshAll(),
  };
}
