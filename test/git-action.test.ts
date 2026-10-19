import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTION_PROBE_ARGS,
  actionLabel,
  emptyMarkers,
  readGitAction,
  readMarkers,
} from "../src/git-action.js";
import { emptyGitStatus, readGitStatus } from "../src/git.js";
import type { GitExec, GitExecResult } from "../src/git.js";
import { composeGitRail } from "../src/footer.js";
import { resolveGlyphs } from "../src/icons.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: "/tmp",
  GIT_EDITOR: "true",
};

const realExec: GitExec = async (args, cwd) => {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      env: ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { kind: "ok", stdout };
  } catch {
    return { kind: "failed", transient: false, code: 1 };
  }
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "init.defaultBranch=main", ...args], {
    cwd,
    env: ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function repo(): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "pi-act-"));
  git(root, ["init", "-q", "."]);
  writeFileSync(join(root, "f.txt"), "one\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "one"]);
  return { dir: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Conflicting side branch: both sides rewrite f.txt. */
function diverge(dir: string, side: string, main: string): void {
  git(dir, ["checkout", "-q", "-b", "side"]);
  writeFileSync(join(dir, "f.txt"), `${side}\n`);
  git(dir, ["commit", "-qam", side]);
  git(dir, ["checkout", "-q", "main"]);
  writeFileSync(join(dir, "f.txt"), `${main}\n`);
  git(dir, ["commit", "-qam", main]);
}

describe("git action — labels (pure)", () => {
  test("no markers means no action", () => {
    assert.equal(actionLabel(emptyMarkers()), "");
  });

  test("merge", () => {
    assert.equal(actionLabel({ ...emptyMarkers(), mergeHead: true }), "MERGING");
  });

  test("interactive rebase with progress", () => {
    assert.equal(
      actionLabel({
        ...emptyMarkers(),
        rebaseMerge: true,
        interactive: true,
        progress: { current: 2, total: 7 },
      }),
      "REBASE-i 2/7",
    );
  });

  test("merge-backend rebase without progress files", () => {
    assert.equal(actionLabel({ ...emptyMarkers(), rebaseMerge: true }), "REBASE");
  });

  test("apply-backend rebase carries its progress", () => {
    assert.equal(
      actionLabel({ ...emptyMarkers(), rebaseApply: true, progress: { current: 2, total: 7 } }),
      "REBASE 2/7",
    );
  });

  test("am is the applying flavour of rebase-apply", () => {
    assert.equal(
      actionLabel({
        ...emptyMarkers(),
        rebaseApply: true,
        applying: true,
        progress: { current: 1, total: 1 },
      }),
      "AM",
      "AM does not show progress, unlike a rebase on the same backend",
    );
  });

  test("cherry-pick, revert and bisect", () => {
    assert.equal(actionLabel({ ...emptyMarkers(), cherryPickHead: true }), "CHERRY-PICKING");
    assert.equal(actionLabel({ ...emptyMarkers(), revertHead: true }), "REVERTING");
    assert.equal(actionLabel({ ...emptyMarkers(), bisectLog: true }), "BISECTING");
  });

  test("git-prompt.sh precedence: rebase owns the worktree", () => {
    const all = {
      ...emptyMarkers(),
      mergeHead: true,
      rebaseMerge: true,
      cherryPickHead: true,
      revertHead: true,
      bisectLog: true,
    };
    assert.equal(actionLabel(all), "REBASE", "a rebase in flight outranks every other marker");
    assert.equal(
      actionLabel({ ...all, rebaseMerge: false, rebaseApply: true }),
      "REBASE",
      "apply backend outranks merge",
    );
    assert.equal(actionLabel({ ...all, rebaseMerge: false, mergeHead: true }), "MERGING");
    assert.equal(
      actionLabel({ ...all, rebaseMerge: false, mergeHead: false, cherryPickHead: true }),
      "CHERRY-PICKING",
    );
    assert.equal(
      actionLabel({
        ...all,
        rebaseMerge: false,
        mergeHead: false,
        cherryPickHead: false,
        revertHead: true,
      }),
      "REVERTING",
    );
  });
});

describe("git action — real repository states", () => {
  test("merge with unresolved conflicts", async () => {
    const { dir, cleanup } = repo();
    try {
      diverge(dir, "side", "main");
      try {
        git(dir, ["merge", "side"]);
      } catch {
        /* conflicts are the point */
      }
      assert.equal(await readGitAction(dir, realExec), "MERGING");
      const status = await readGitStatus(dir, realExec);
      assert.equal(status?.unmerged, 1, "the red branch case");
    } finally {
      cleanup();
    }
  });

  test("merge with the conflicts resolved and staged still carries the label", async () => {
    const { dir, cleanup } = repo();
    try {
      diverge(dir, "side", "main");
      try {
        git(dir, ["merge", "side"]);
      } catch {
        /* conflicts */
      }
      writeFileSync(join(dir, "f.txt"), "resolved\n");
      git(dir, ["add", "f.txt"]);

      const status = await readGitStatus(dir, realExec);
      assert.equal(status?.unmerged, 0, "staging cleared the conflict signal");
      assert.equal(
        await readGitAction(dir, realExec),
        "MERGING",
        "this is the case #45's unmerged>0 check cannot see",
      );
    } finally {
      cleanup();
    }
  });

  test("interactive rebase stopped mid-step", async () => {
    const { dir, cleanup } = repo();
    try {
      writeFileSync(join(dir, "g.txt"), "two\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-qm", "two"]);
      writeFileSync(join(dir, "h.txt"), "three\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-qm", "three"]);

      const seq = join(dir, "..", `seq-${Date.now()}.sh`);
      writeFileSync(seq, '#!/bin/sh\nsed -i.bak "2s/^pick/edit/" "$1"\n');
      execFileSync("chmod", ["+x", seq]);
      try {
        execFileSync("git", ["-c", "init.defaultBranch=main", "rebase", "-i", "HEAD~2"], {
          cwd: dir,
          env: { ...ENV, GIT_SEQUENCE_EDITOR: seq },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        /* it stops at the edit step */
      }

      assert.equal(await readGitAction(dir, realExec), "REBASE-i 2/2");
    } finally {
      cleanup();
    }
  });

  test("git am in flight", async () => {
    const { dir, cleanup } = repo();
    try {
      const patches = mkdtempSync(join(tmpdir(), "pi-patch-"));
      try {
        git(dir, ["checkout", "-q", "-b", "side"]);
        writeFileSync(join(dir, "f.txt"), "side\n");
        git(dir, ["commit", "-qam", "side"]);
        git(dir, ["format-patch", "-1", "-o", patches]);
        git(dir, ["checkout", "-q", "main"]);
        writeFileSync(join(dir, "f.txt"), "main\n");
        git(dir, ["commit", "-qam", "main"]);

        const patch = join(patches, execFileSync("ls", [patches], { encoding: "utf8" }).trim());
        try {
          git(dir, ["am", patch]);
        } catch {
          /* conflict */
        }
        assert.equal(await readGitAction(dir, realExec), "AM");
      } finally {
        rmSync(patches, { recursive: true, force: true });
      }
    } finally {
      cleanup();
    }
  });

  test("cherry-pick in flight", async () => {
    const { dir, cleanup } = repo();
    try {
      git(dir, ["checkout", "-q", "-b", "side"]);
      writeFileSync(join(dir, "f.txt"), "side\n");
      git(dir, ["commit", "-qam", "side"]);
      git(dir, ["checkout", "-q", "-b", "other", "main"]);
      writeFileSync(join(dir, "f.txt"), "other\n");
      git(dir, ["commit", "-qam", "other"]);
      try {
        git(dir, ["cherry-pick", "side"]);
      } catch {
        /* conflict */
      }
      assert.equal(await readGitAction(dir, realExec), "CHERRY-PICKING");
    } finally {
      cleanup();
    }
  });

  test("revert in flight", async () => {
    const { dir, cleanup } = repo();
    try {
      writeFileSync(join(dir, "f.txt"), "A\n");
      git(dir, ["commit", "-qam", "A"]);
      writeFileSync(join(dir, "f.txt"), "B\n");
      git(dir, ["commit", "-qam", "B"]);
      try {
        git(dir, ["revert", "--no-edit", "HEAD~1"]);
      } catch {
        /* conflict */
      }
      assert.equal(await readGitAction(dir, realExec), "REVERTING");
    } finally {
      cleanup();
    }
  });

  test("bisect in flight", async () => {
    const { dir, cleanup } = repo();
    try {
      writeFileSync(join(dir, "g.txt"), "two\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-qm", "two"]);
      try {
        git(dir, ["bisect", "start"]);
        git(dir, ["bisect", "bad"]);
        git(dir, ["bisect", "good", "HEAD~1"]);
      } catch {
        /* bisect may need a midpoint */
      }
      assert.equal(await readGitAction(dir, realExec), "BISECTING");
    } finally {
      cleanup();
    }
  });

  test("stash-pop conflict is a conflict, not an action", async () => {
    const { dir, cleanup } = repo();
    try {
      writeFileSync(join(dir, "f.txt"), "stashed\n");
      git(dir, ["stash"]);
      writeFileSync(join(dir, "f.txt"), "worktree\n");
      git(dir, ["commit", "-qam", "worktree"]);
      try {
        git(dir, ["stash", "pop"]);
      } catch {
        /* conflict */
      }
      assert.equal(
        await readGitAction(dir, realExec),
        "",
        "no marker: the branch carries the colour",
      );
      const status = await readGitStatus(dir, realExec);
      assert.equal(status?.unmerged, 1);
    } finally {
      cleanup();
    }
  });

  test("clean repository has no action", async () => {
    const { dir, cleanup } = repo();
    try {
      assert.equal(await readGitAction(dir, realExec), "");
    } finally {
      cleanup();
    }
  });
});

describe("git action — probe budget and failure", () => {
  test("one spawn per refresh", async () => {
    const calls: string[][] = [];
    const exec: GitExec = async (args) => {
      calls.push([...args]);
      return {
        kind: "ok",
        stdout:
          ".git/MERGE_HEAD\n.git/rebase-merge\n.git/rebase-apply\n.git/CHERRY_PICK_HEAD\n.git/REVERT_HEAD\n.git/BISECT_LOG\n",
      };
    };
    await readGitAction("/tmp", exec);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [...ACTION_PROBE_ARGS]);
  });

  test("a failed probe means no action, never a throw", async () => {
    const failed = async (): Promise<GitExecResult> => ({
      kind: "failed",
      transient: true,
      code: null,
    });
    assert.equal(await readGitAction("/tmp", failed), "");
    assert.deepEqual(await readMarkers("/tmp", failed), emptyMarkers());
  });
});

describe("git action — rail composition", () => {
  const glyphs = resolveGlyphs("ascii");
  const render = (action: string, unmerged = 0): string =>
    composeGitRail(
      { ...emptyGitStatus(), branch: "main", staged: 2, unstaged: 1, untracked: 3, unmerged },
      glyphs,
      DEFAULT_CONFIG.footerSegments,
      action,
    )
      .map((p) => p.text)
      .join(" ");

  test("the label renders with a pipe and suppresses the counts", () => {
    assert.equal(render("MERGING"), "main |MERGING");
    assert.equal(render("REBASE 2/7"), "main |REBASE 2/7");
  });

  test("the label is warning-coloured, or error-coloured while conflicts remain", () => {
    const color = (unmerged: number): string | undefined =>
      composeGitRail(
        { ...emptyGitStatus(), branch: "main", unmerged },
        glyphs,
        DEFAULT_CONFIG.footerSegments,
        "MERGING",
      ).at(-1)?.color;
    assert.equal(color(0), "warning");
    assert.equal(color(2), "error");
  });

  test("clean repository keeps its counts and has no label", () => {
    assert.equal(render(""), "main A2 ! ?3");
  });
});
