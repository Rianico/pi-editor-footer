import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2000;

/**
 * Everything the rail draws, and nothing else (ADR-0003).
 *
 * `deleted`/`renamed` fold into the staged/unstaged counts, `modified` is gone as a
 * kind, and the porcelain-v1 parse that could not see divergence is gone with it.
 */
export interface GitCommitInfo {
  oid: string | null;
  detached: boolean;
  tag: string | null;
}

export interface GitStatus {
  branch: string | undefined;
  commit: GitCommitInfo | null;
  staged: number;
  unstaged: number;
  untracked: number;
  stashed: number;
  behind: number;
  ahead: number;
  unmerged: number;
}

export function emptyGitStatus(): GitStatus {
  return {
    branch: undefined,
    commit: null,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    stashed: 0,
    behind: 0,
    ahead: 0,
    unmerged: 0,
  };
}

/**
 * The one read. `--show-stash` is what makes `# stash N` appear; `-z` is what keeps
 * path names from needing unquoting, and `--untracked-files=all` matches `-uall` so
 * untracked directories are counted file by file.
 */
export const GIT_STATUS_ARGS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--show-stash",
  "--untracked-files=all",
] as const;

/**
 * The same read without `--show-stash`, for git builds that reject the flag (unknown option,
 * exit 129). Costs one extra spawn only on that failure path, and yields a partial rail.
 */
export const PARTIAL_STATUS_ARGS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--untracked-files=all",
] as const;

/**
 * Outcome of one git spawn.
 *
 * The failure *kind* is load-bearing: a timeout says "I do not know" and must keep the last
 * known rail, while a clean non-zero exit says "I know, and the answer is nothing" (not a
 * repo), which is what lets the rail fall back to `(no git)` instead of pinning stale state.
 */
export type GitExecResult =
  | { readonly kind: "ok"; readonly stdout: string }
  | { readonly kind: "failed"; readonly transient: boolean; readonly code: number | null };

/** Subprocess seam: tests assert the spawn count and the failure kind through it. */
export type GitExec = (args: string[], cwd: string) => Promise<GitExecResult>;

export async function gitExec(args: string[], cwd: string): Promise<GitExecResult> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return { kind: "ok", stdout };
  } catch (error) {
    // SAFETY: best-effort — a failed spawn is data (which kind of failure), never a throw.
    const failed = error as { code?: unknown; killed?: unknown };
    const killed = failed.killed === true;
    const code = typeof failed.code === "number" ? failed.code : null;
    // Killed/timeout has no exit status: the state is unknown, so the caller keeps its own.
    return { kind: "failed", transient: killed || code === null, code };
  }
}

/**
 * Keep the last known rail when a read could not answer (transient failure).
 *
 * `null` means "unknown", not "clean": replacing state with `emptyGitStatus()` here would
 * flicker the rail to `(no git)` on every timeout.
 */
export function mergeGitStatus(previous: GitStatus, next: GitStatus | null): GitStatus {
  return next ?? previous;
}

/**
 * Parse `git status --porcelain=v2 -z --branch --show-stash --untracked-files=all`.
 *
 * Headers (`# …`) carry branch, upstream divergence and stash; record types carry the
 * counts. `-z` terminates every field with NUL, and a `2` (rename/copy) record is
 * followed by a second NUL field holding the original path — that field is a bare
 * path, so it must be skipped rather than read as a record.
 */
export function parseGitStatus(stdout: string): GitStatus {
  const status = emptyGitStatus();
  const fields = stdout.split("\0");
  let oid: string | null = null;
  let detached = false;
  let sawHead = false;

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;

    if (field.startsWith("# ")) {
      const header = field.slice(2);
      if (header.startsWith("branch.oid ")) {
        const value = header.slice("branch.oid ".length).trim();
        oid = value === "(initial)" ? null : value;
      } else if (header.startsWith("branch.head ")) {
        const value = header.slice("branch.head ".length).trim();
        sawHead = true;
        if (value === "(detached)") detached = true;
        else status.branch = value;
      } else if (header.startsWith("branch.ab ")) {
        // Present only while an upstream is configured: divergence comes from here,
        // never from a branch suffix — that is what lost the name on `[ahead 1, behind 2]`.
        const ab = /^\+(\d+)\s+-(\d+)$/.exec(header.slice("branch.ab ".length).trim());
        if (ab) {
          status.ahead = Number(ab[1]);
          status.behind = Number(ab[2]);
        }
      } else if (header.startsWith("stash ")) {
        const stashed = Number.parseInt(header.slice("stash ".length).trim(), 10);
        if (!Number.isNaN(stashed)) status.stashed = stashed;
      }
      continue;
    }

    switch (field[0]) {
      case "1":
      case "2": {
        const x = field[2];
        const y = field[3];
        if (x !== undefined && x !== ".") status.staged++;
        if (y !== undefined && y !== ".") status.unstaged++;
        // A rename/copy record is followed by its original path as a separate -z field.
        if (field[0] === "2") i++;
        break;
      }
      case "u":
        status.unmerged++;
        break;
      case "?":
        status.untracked++;
        break;
      default:
        break;
    }
  }

  if (sawHead) status.commit = { oid, detached, tag: null };
  return status;
}

export function readGitStatus(cwd: string, exec: GitExec = gitExec): Promise<GitStatus | null> {
  return acquireGitStatus(cwd, exec);
}

/**
 * `null` means "could not answer" (timeout, killed, unparseable failure): keep the last rail.
 * A clean non-zero exit is an answer — not a work tree — so it yields the empty status and the
 * rail is free to render `(no git)`.
 */
async function acquireGitStatus(cwd: string, exec: GitExec): Promise<GitStatus | null> {
  let result = await exec([...GIT_STATUS_ARGS], cwd);

  // Some git builds predate `--show-stash` and reject it as an unknown option (exit 129).
  // Retrying without it buys a partial rail (everything but the stash part) instead of
  // degrading the whole repository to `(no git)`.
  if (result.kind === "failed" && !result.transient && result.code === 129) {
    result = await exec([...PARTIAL_STATUS_ARGS], cwd);
  }

  if (result.kind === "failed") {
    return result.transient ? null : emptyGitStatus();
  }

  const status = parseGitStatus(result.stdout);

  // One conditional second spawn, detached only: the oid and divergence already came
  // from the status read, so a tag is the only thing left to ask git for.
  if (status.commit?.detached) {
    const tag = await exec(["describe", "--tags", "--exact-match", "HEAD"], cwd);
    if (tag.kind === "ok") {
      const trimmed = tag.stdout.trim();
      status.commit.tag = trimmed.length > 0 ? trimmed : null;
    }
  }

  return status;
}
