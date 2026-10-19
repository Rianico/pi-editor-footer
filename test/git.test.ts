import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGitStatus, GIT_STATUS_ARGS, parseGitStatus, readGitStatus } from "../src/git.js";
import type { GitExec } from "../src/git.js";

/** `-z` output: every field is NUL-terminated (records below are joined with \0). */
const z = (...fields: string[]): string => fields.map((f) => `${f}\0`).join("");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: "/tmp",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "init.defaultBranch=main", ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "pi-git-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Bare origin + a clone that has pushed `n` commits and tracks origin/main. */
function makeClonedRepo(): { root: string; work: string; origin: string; cleanup: () => void } {
  const { root, cleanup } = makeRepo();
  const origin = join(root, "origin.git");
  git(root, ["init", "-q", "--bare", origin]);
  const work = join(root, "work");
  git(root, ["clone", "-q", origin, work]);
  for (let i = 0; i < 2; i++) {
    writeFileSync(join(work, `f${i}.txt`), `${i}\n`);
    git(work, ["add", "."]);
    git(work, ["commit", "-qm", `c${i}`]);
  }
  git(work, ["push", "-q", "-u", "origin", "HEAD"]);
  return { root, work, origin, cleanup };
}

describe("git", () => {
  test("emptyGitStatus has defaults", () => {
    const s = emptyGitStatus();
    assert.equal(s.branch, undefined);
    assert.equal(s.ahead, 0);
    assert.equal(s.behind, 0);
    assert.equal(s.staged, 0);
    assert.equal(s.unstaged, 0);
    assert.equal(s.untracked, 0);
    assert.equal(s.stashed, 0);
    assert.equal(s.unmerged, 0);
    assert.equal(s.commit, null);
  });

  test("readGitStatus on non-git dir returns empty", async () => {
    const { root, cleanup } = makeRepo();
    try {
      const status = await readGitStatus(root);
      assert.equal(status.branch, undefined);
      assert.equal(status.staged, 0);
    } finally {
      cleanup();
    }
  });

  test("readGitStatus on this repo returns branch", async () => {
    const status = await readGitStatus(process.cwd());
    // Branch may be undefined if detached, but should not throw
    assert.ok(typeof status.ahead === "number");
    assert.ok(typeof status.staged === "number");
  });

  // --- defect 1: a diverged branch must keep its name (ADR-0003) ---
  test("diverged branch keeps its name and reports ahead+behind", async () => {
    const { root, work, origin, cleanup } = makeClonedRepo();
    try {
      // local commit …
      writeFileSync(join(work, "local.txt"), "local\n");
      git(work, ["add", "."]);
      git(work, ["commit", "-qm", "local"]);
      // … and a commit on the remote from a second clone, so the branch diverges
      const other = join(root, "other");
      git(root, ["clone", "-q", origin, other]);
      writeFileSync(join(other, "remote.txt"), "remote\n");
      git(other, ["add", "."]);
      git(other, ["commit", "-qm", "remote"]);
      git(other, ["push", "-q", "origin", "HEAD"]);
      git(work, ["fetch", "-q"]);

      const status = await readGitStatus(work);
      assert.equal(status.branch, "main", "diverged branch must keep its name");
      assert.equal(status.ahead, 1);
      assert.equal(status.behind, 1);
    } finally {
      cleanup();
    }
  });

  // --- defect 2: a [gone] upstream must not drop the branch ---
  test("gone upstream keeps the branch name", async () => {
    const { work, origin, cleanup } = makeClonedRepo();
    try {
      git(origin, ["update-ref", "-d", "refs/heads/main"]);
      git(work, ["fetch", "-q", "--prune"]);

      const status = await readGitStatus(work);
      assert.equal(status.branch, "main", "gone upstream must keep its name");
      assert.equal(status.ahead, 0);
      assert.equal(status.behind, 0);
    } finally {
      cleanup();
    }
  });

  // --- defect 3: a detached HEAD must show the commit, plus its tag ---
  test("detached HEAD reports the commit oid and exact tag", async () => {
    const { work, cleanup } = makeClonedRepo();
    try {
      git(work, ["tag", "v0.13.0"]);
      git(work, ["checkout", "-q", "v0.13.0"]);

      const status = await readGitStatus(work);
      assert.equal(status.branch, undefined, "detached has no branch name");
      assert.ok(status.commit?.detached, "detached flag must be set");
      assert.match(status.commit?.oid ?? "", /^[0-9a-f]{40}$/, "detached must carry the oid");
      assert.equal(status.commit?.tag, "v0.13.0");
    } finally {
      cleanup();
    }
  });
});

describe("git — porcelain v2 parse (ADR-0003)", () => {
  test("diverged: divergence comes from the header, not a branch suffix", () => {
    const s = parseGitStatus(
      z(
        "# branch.oid 43e36c3d8f3412cb2477ad9343b3fe87e3ff8641",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +1 -1",
      ),
    );
    assert.equal(s.branch, "main");
    assert.equal(s.ahead, 1);
    assert.equal(s.behind, 1);
  });

  test("gone upstream: no branch.ab at all, branch survives", () => {
    const s = parseGitStatus(
      z(
        "# branch.oid 88aea4a26c3983df875be03a657008ab7ed719f8",
        "# branch.head main",
        "# branch.upstream origin/main",
      ),
    );
    assert.equal(s.branch, "main");
    assert.equal(s.ahead, 0);
    assert.equal(s.behind, 0);
  });

  test("detached: oid is carried, branch is absent", () => {
    const s = parseGitStatus(
      z("# branch.oid 88aea4a26c3983df875be03a657008ab7ed719f8", "# branch.head (detached)"),
    );
    assert.equal(s.branch, undefined);
    assert.equal(s.commit?.detached, true);
    assert.equal(s.commit?.oid, "88aea4a26c3983df875be03a657008ab7ed719f8");
  });

  test("unborn: (initial) oid is null but the branch is known", () => {
    const s = parseGitStatus(z("# branch.oid (initial)", "# branch.head main"));
    assert.equal(s.branch, "main");
    assert.equal(s.commit?.oid, null);
    assert.equal(s.commit?.detached, false);
  });

  test("stash header counts stashed entries", () => {
    assert.equal(parseGitStatus(z("# branch.head main", "# stash 3")).stashed, 3);
  });

  test("AM double-counts: staged and unstaged both move", () => {
    const s = parseGitStatus(
      z("# branch.head main", "1 AM N... 100644 100644 100644 aaa bbb new.txt"),
    );
    assert.equal(s.staged, 1);
    assert.equal(s.unstaged, 1);
    assert.equal(s.untracked, 0);
  });

  test("rename record's second -z field is a path, not a record", () => {
    const s = parseGitStatus(
      z(
        "# branch.head main",
        "2 R. N... 100644 100644 100644 aaa bbb R100 renamed.txt",
        "ren.txt",
        "? un1.txt",
      ),
    );
    assert.equal(s.staged, 1, "the rename counts once");
    assert.equal(s.unstaged, 0);
    assert.equal(s.untracked, 1, "the original path did not swallow the untracked record");
  });

  test("untracked-only tree is not clean", () => {
    const s = parseGitStatus(z("# branch.head main", "? a.txt", "? b.txt"));
    assert.equal(s.untracked, 2);
    assert.equal(s.staged, 0);
    assert.equal(s.unstaged, 0);
  });

  test("unmerged records count as unmerged only", () => {
    const s = parseGitStatus(
      z("# branch.head main", "u UU N... 100644 100644 100644 100644 aaa bbb ccc f.txt"),
    );
    assert.equal(s.unmerged, 1);
    assert.equal(s.staged, 0, "a conflict is not user staging");
    assert.equal(s.unstaged, 0);
  });
});

describe("git — spawn budget (one read per refresh)", () => {
  function countingExec(statusOut: string, describeOut: string | null) {
    const calls: string[][] = [];
    const exec: GitExec = async (args) => {
      calls.push([...args]);
      return args[0] === "describe" ? describeOut : statusOut;
    };
    return { calls, exec };
  }

  test("normal path is exactly one status spawn", async () => {
    const { calls, exec } = countingExec(z("# branch.head main", "# branch.ab +1 -2"), null);
    const s = await readGitStatus("/tmp", exec);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [...GIT_STATUS_ARGS]);
    assert.equal(s.ahead, 1);
    assert.equal(s.behind, 2);
  });

  test("detached adds exactly one describe spawn", async () => {
    const { calls, exec } = countingExec(
      z("# branch.oid 88aea4a26c3983df875be03a657008ab7ed719f8", "# branch.head (detached)"),
      "v0.13.0\n",
    );
    const s = await readGitStatus("/tmp", exec);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ["describe", "--tags", "--exact-match", "HEAD"]);
    assert.equal(s.commit?.tag, "v0.13.0");
  });

  test("a failed status read yields the empty status, not a throw", async () => {
    const exec: GitExec = async () => null;
    assert.deepEqual(await readGitStatus("/tmp", exec), emptyGitStatus());
  });
});
