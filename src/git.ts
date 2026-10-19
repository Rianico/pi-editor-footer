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

/** Subprocess seam: tests assert the spawn count through it. */
export type GitExec = (args: string[], cwd: string) => Promise<string | null>;

async function gitExec(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    // SAFETY: best-effort, ignore recoverable error
    return null;
  }
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

export async function readGitStatus(cwd: string, exec: GitExec = gitExec): Promise<GitStatus> {
  const stdout = await exec([...GIT_STATUS_ARGS], cwd);
  if (stdout === null) {
    return emptyGitStatus();
  }

  const status = parseGitStatus(stdout);

  // One conditional second spawn, detached only: the oid and divergence already came
  // from the status read, so a tag is the only thing left to ask git for.
  if (status.commit?.detached) {
    const tag = await exec(["describe", "--tags", "--exact-match", "HEAD"], cwd);
    if (tag !== null) {
      const trimmed = tag.trim();
      status.commit.tag = trimmed.length > 0 ? trimmed : null;
    }
  }

  return status;
}
