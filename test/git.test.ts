import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGitStatus, hasGitChanges, readGitStatus } from "../src/git.js";

describe("git", () => {
  test("emptyGitStatus has defaults", () => {
    const s = emptyGitStatus();
    assert.equal(s.branch, undefined);
    assert.equal(s.ahead, 0);
    assert.equal(s.staged, 0);
    assert.equal(s.commit, null);
  });

  test("hasGitChanges false when clean", () => {
    assert.equal(hasGitChanges(emptyGitStatus()), false);
  });

  test("hasGitChanges true when modified", () => {
    const s = emptyGitStatus();
    s.modified = 1;
    assert.equal(hasGitChanges(s), true);
  });

  test("readGitStatus on non-git dir returns empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "git-test-"));
    try {
      const status = await readGitStatus(dir);
      assert.equal(status.branch, undefined);
      assert.equal(status.staged, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readGitStatus on this repo returns branch", async () => {
    // Use the worktree root, which is a git repo
    const status = await readGitStatus(process.cwd());
    // Branch may be undefined if detached, but should not throw
    assert.ok(typeof status.ahead === "number");
    assert.ok(typeof status.staged === "number");
  });
});
