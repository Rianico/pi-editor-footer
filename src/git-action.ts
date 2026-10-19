import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { gitExec } from "./git.js";
import type { GitExec } from "./git.js";

/**
 * One batched spawn: `--git-path` resolves the marker location the way git itself would, so
 * this works in linked worktrees and submodules instead of guessing at `.git/`.
 */
export const ACTION_PROBE_ARGS = [
  "rev-parse",
  "--git-path",
  "MERGE_HEAD",
  "--git-path",
  "rebase-merge",
  "--git-path",
  "rebase-apply",
  "--git-path",
  "CHERRY_PICK_HEAD",
  "--git-path",
  "REVERT_HEAD",
  "--git-path",
  "BISECT_LOG",
] as const;

export interface ActionProgress {
  readonly current: number;
  readonly total: number;
}

export interface ActionMarkers {
  readonly mergeHead: boolean;
  readonly rebaseMerge: boolean;
  readonly rebaseApply: boolean;
  readonly cherryPickHead: boolean;
  readonly revertHead: boolean;
  readonly bisectLog: boolean;
  /** `rebase-merge/interactive` — the merge backend's interactive flavour. */
  readonly interactive: boolean;
  /** `rebase-apply/applying` — `git am` rather than a rebase. */
  readonly applying: boolean;
  readonly progress: ActionProgress | null;
}

export function emptyMarkers(): ActionMarkers {
  return {
    mergeHead: false,
    rebaseMerge: false,
    rebaseApply: false,
    cherryPickHead: false,
    revertHead: false,
    bisectLog: false,
    interactive: false,
    applying: false,
    progress: null,
  };
}

/**
 * git-prompt.sh precedence, which is also what powerlevel10k follows: a rebase in flight
 * wins over everything else, because it owns the worktree until it finishes.
 */
export function actionLabel(markers: ActionMarkers): string {
  const withProgress = (base: string): string =>
    markers.progress === null
      ? base
      : `${base} ${markers.progress.current}/${markers.progress.total}`;

  if (markers.rebaseMerge) return withProgress(markers.interactive ? "REBASE-i" : "REBASE");
  if (markers.rebaseApply) return markers.applying ? "AM" : withProgress("REBASE");
  if (markers.mergeHead) return "MERGING";
  if (markers.cherryPickHead) return "CHERRY-PICKING";
  if (markers.revertHead) return "REVERTING";
  if (markers.bisectLog) return "BISECTING";
  return "";
}

/**
 * Detect the in-progress operation, or `""` when none is running.
 *
 * A failed probe is "no action", never an error and never an empty rail: the caller keeps
 * rendering branch and counts, the label simply goes away.
 */
export async function readGitAction(cwd: string, exec: GitExec = gitExec): Promise<string> {
  return actionLabel(await readMarkers(cwd, exec));
}

export async function readMarkers(cwd: string, exec: GitExec = gitExec): Promise<ActionMarkers> {
  const result = await exec([...ACTION_PROBE_ARGS], cwd);
  if (result.kind !== "ok") return emptyMarkers();

  // `--git-path` answers with paths relative to the *current* directory (e.g.
  // `../.git/MERGE_HEAD` from a subdirectory), so every answer resolves against cwd.
  const paths = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => resolve(cwd, line));
  if (paths.length < PROBE_FIELDS) return emptyMarkers();

  const [mergeHead, rebaseMerge, rebaseApply, cherryPickHead, revertHead, bisectLog] = paths as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const [hasMerge, hasRebaseMerge, hasRebaseApply, hasCherryPick, hasRevert, hasBisect] =
    await Promise.all([
      exists(mergeHead),
      exists(rebaseMerge),
      exists(rebaseApply),
      exists(cherryPickHead),
      exists(revertHead),
      exists(bisectLog),
    ]);

  const [interactive, applying] = await Promise.all([
    hasRebaseMerge ? exists(resolve(rebaseMerge, "interactive")) : false,
    hasRebaseApply ? exists(resolve(rebaseApply, "applying")) : false,
  ]);

  // Progress lives in different files per backend: the merge backend counts msgnum/end,
  // the apply backend counts next/last.
  const progress = hasRebaseMerge
    ? await readProgress(resolve(rebaseMerge, "msgnum"), resolve(rebaseMerge, "end"))
    : hasRebaseApply && !applying
      ? await readProgress(resolve(rebaseApply, "next"), resolve(rebaseApply, "last"))
      : null;

  return {
    mergeHead: hasMerge,
    rebaseMerge: hasRebaseMerge,
    rebaseApply: hasRebaseApply,
    cherryPickHead: hasCherryPick,
    revertHead: hasRevert,
    bisectLog: hasBisect,
    interactive,
    applying,
    progress,
  };
}

const PROBE_FIELDS = 6;

async function readProgress(
  currentPath: string,
  totalPath: string,
): Promise<ActionProgress | null> {
  const [current, total] = await Promise.all([readNumber(currentPath), readNumber(totalPath)]);
  if (current === null || total === null) return null;
  return { current, total };
}

async function readNumber(path: string): Promise<number | null> {
  try {
    const parsed = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
