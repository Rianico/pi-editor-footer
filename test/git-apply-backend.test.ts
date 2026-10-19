import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitAction } from "../src/git-action.js";
import type { GitExec } from "../src/git.js";

/**
 * The apply-backend rebase is the one action state whose progress files are easy to get
 * wrong: `rebase-apply/` is shared by `git am` and by `git rebase --apply`, and only `am`
 * writes the `applying` sentinel, while the label differs — `AM` versus `REBASE n/m`. The
 * decision must therefore be made against a real tree, not a hand-written porcelain fixture.
 *
 * The `git am` side is covered in test/git-action.test.ts; this file owns the other half.
 */
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

/** Runs git and reports the exit status instead of throwing, so fixture setup stays linear. */
function git(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync("git", ["-c", "init.defaultBranch=main", ...args], {
      cwd,
      env: ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * main c1 → c2 → c3, plus `base` off c1 rewriting the same file, so `git rebase --apply base`
 * must stop with a conflict while replaying c2 and c3.
 */
function conflictedApplyRebase(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-apply-"));
  git(dir, ["init", "-q", "."]);
  writeFileSync(join(dir, "f.txt"), "one\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-qm", "c1"]);
  writeFileSync(join(dir, "f.txt"), "two\n");
  git(dir, ["commit", "-qam", "c2"]);
  writeFileSync(join(dir, "f.txt"), "three\n");
  git(dir, ["commit", "-qam", "c3"]);

  git(dir, ["checkout", "-q", "-b", "base", "HEAD~2"]);
  writeFileSync(join(dir, "f.txt"), "base\n");
  git(dir, ["commit", "-qam", "base"]);
  git(dir, ["checkout", "-q", "main"]);

  const rebase = git(dir, ["rebase", "--apply", "base"]);
  assert.equal(rebase.ok, false, "the fixture must conflict, otherwise no operation is in flight");

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function progressTotal(dir: string): number {
  return Number.parseInt(
    readFileSync(join(dir, ".git", "rebase-apply", "last"), "utf8").trim(),
    10,
  );
}

describe("git action — apply-backend rebase (real git state)", () => {
  test("rebase --apply without an `applying` sentinel reports progress, not am", async () => {
    const { dir, cleanup } = conflictedApplyRebase();
    try {
      const gitDir = join(dir, ".git", "rebase-apply");
      // Preconditions, asserted so a future git changing the layout fails loudly here instead
      // of leaving the label assertion accidentally vacuous.
      assert.ok(existsSync(gitDir), "rebase-apply/ must exist");
      assert.equal(
        existsSync(join(gitDir, "applying")),
        false,
        "only `git am` writes `applying`; a rebase on the same backend does not",
      );
      assert.ok(existsSync(join(gitDir, "next")), "progress file `next` must exist");
      assert.ok(existsSync(join(gitDir, "last")), "progress file `last` must exist");

      const total = progressTotal(dir);
      assert.ok(total >= 2, `two commits are replayed, got last=${total}`);

      assert.equal(
        await readGitAction(dir, realExec),
        `REBASE 1/${total}`,
        "an apply-backend rebase shows progress; calling it `am` would be wrong",
      );
    } finally {
      cleanup();
    }
  });

  test("the same backend with `applying` present reports am instead", async () => {
    // The discriminator is the sentinel file, not the backend: adding only `applying` to the
    // same real tree must flip the label, otherwise the shared rebase-apply path swallowed it.
    const { dir, cleanup } = conflictedApplyRebase();
    try {
      writeFileSync(join(dir, ".git", "rebase-apply", "applying"), "");
      assert.equal(await readGitAction(dir, realExec), "AM");
    } finally {
      cleanup();
    }
  });
});
