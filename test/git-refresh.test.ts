/**
 * Git rail refresh contract.
 *
 * pi's footer data provider only reports branch *renames*, so the rail's staleness bug
 * was a missing trigger, not a bad parse: these tests pin the trigger (immediate read on
 * arm, settle-driven requests, coalescing) and the repaint decision, not the git output.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGitStatus, mergeGitStatus, railKey, readGitStatus } from "../src/git.js";
import { readGitAction } from "../src/git-action.js";
import { GIT_MIN_GAP_MS, GitRefresher } from "../src/git-refresh.js";
import type { GitRailSnapshot } from "../src/git-refresh.js";

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a condition instead of guessing a sleep: real git spawns are not clockwork. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await tick(5);
  }
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: "/tmp",
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "init.defaultBranch=main", ...args], {
    cwd,
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function harness(over: Partial<ConstructorParameters<typeof GitRefresher>[0]> = {}) {
  let reads = 0;
  let renders = 0;
  let changed = true;
  let snapshot: GitRailSnapshot = { status: null, action: "" };
  let readError: Error | undefined;
  const refresher = new GitRefresher({
    read: async () => {
      reads++;
      if (readError) throw readError;
      return snapshot;
    },
    apply: () => changed,
    render: () => {
      renders++;
    },
    minGapMs: 0,
    ...over,
  });
  return {
    refresher,
    get reads() {
      return reads;
    },
    get renders() {
      return renders;
    },
    setChanged(value: boolean) {
      changed = value;
    },
    setSnapshot(value: GitRailSnapshot) {
      snapshot = value;
    },
    failNextReads(error: Error | undefined) {
      readError = error;
    },
  };
}

describe("GitRefresher", () => {
  test("start takes exactly one read and never reads on its own", async () => {
    const h = harness();
    h.refresher.start();
    assert.equal(h.reads, 1, "the first read is immediate");
    await tick(60);
    assert.equal(h.reads, 1, "no timer: only an event may trigger another read");
    h.refresher.request();
    await tick(1);
    assert.equal(h.reads, 2, "an event does trigger one");
    h.refresher.stop();
  });

  test("requests while a read is in flight collapse into one trailing read", async () => {
    let release: (() => void) | null = null;
    let reads = 0;
    const refresher = new GitRefresher({
      read: async () => {
        reads++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: null, action: "" };
      },
      apply: () => true,
      render: () => {},
      minGapMs: 0,
    });
    refresher.start();
    refresher.request();
    refresher.request();
    refresher.request();
    assert.equal(reads, 1, "a burst must not queue one read per event");
    release!();
    await tick(1);
    assert.equal(reads, 2, "exactly one trailing read covers the whole burst");
    release!();
    await tick(1);
    assert.equal(reads, 2, "no extra read once the burst is drained");
    refresher.stop();
  });

  test("an event inside the min gap defers instead of spawning", async () => {
    const h = harness({ minGapMs: 25 });
    h.refresher.start();
    assert.equal(h.reads, 1);
    h.refresher.request();
    assert.equal(h.reads, 1, "inside the gap the read is deferred");
    await tick(50);
    assert.equal(h.reads, 2, "the deferred read still lands once the gap closes");
    h.refresher.stop();
  });

  test("renders only when apply reports a change", async () => {
    const h = harness();
    h.setChanged(false);
    h.refresher.start();
    await tick(1);
    assert.equal(h.reads, 1);
    assert.equal(h.renders, 0, "an unchanged rail owes no repaint");
    h.setChanged(true);
    h.refresher.request();
    await tick(1);
    assert.equal(h.renders, 1);
    h.refresher.stop();
  });

  test("a failed read is swallowed and leaves the next read working", async () => {
    const h = harness();
    h.failNextReads(new Error("git exploded"));
    h.refresher.start();
    await tick(1);
    assert.equal(h.renders, 0, "a failed read must not render");
    h.failNextReads(undefined);
    h.refresher.request();
    await tick(1);
    assert.equal(h.renders, 1);
    h.refresher.stop();
  });

  test("a stopped refresher is inert: requests spawn nothing", async () => {
    const h = harness();
    h.refresher.stop();
    h.refresher.request();
    await tick(1);
    assert.equal(h.reads, 0);
    assert.equal(h.refresher.isActive(), false);
  });

  test("start is idempotent", async () => {
    const h = harness();
    h.refresher.start();
    h.refresher.start();
    await tick(1);
    assert.equal(h.reads, 1);
    assert.equal(h.refresher.isActive(), true);
    h.refresher.stop();
  });

  test("the coalescing window is the documented one", () => {
    assert.equal(GIT_MIN_GAP_MS, 500, "events inside half a second share one read");
  });
});

describe("GitRefresher against a real repo", () => {
  test("a settle-driven request picks up an untracked file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-git-refresh-"));
    try {
      git(dir, ["init", "-q"]);
      writeFileSync(join(dir, "a.txt"), "a");
      git(dir, ["add", "a.txt"]);
      git(dir, ["commit", "-qm", "init"]);

      let renderedStatus = emptyGitStatus();
      let key = railKey(renderedStatus, "");
      let renders = 0;
      const refresher = new GitRefresher({
        read: async () => ({
          status: await readGitStatus(dir),
          action: await readGitAction(dir),
        }),
        apply: (snapshot) => {
          const git = mergeGitStatus(renderedStatus, snapshot.status);
          const next = railKey(git, snapshot.action);
          if (next === key) return false;
          renderedStatus = git;
          key = next;
          return true;
        },
        render: () => {
          renders++;
        },
        minGapMs: 0,
      });

      refresher.start();
      await waitFor(() => renders >= 1);
      assert.equal(renderedStatus.branch, "main");
      assert.equal(renderedStatus.untracked, 0);

      // The reported bug: `git add`/`commit` fire no pi event, so the settle is the
      // trigger that has to re-read — nothing else will.
      writeFileSync(join(dir, "b.txt"), "b");
      refresher.request();
      await waitFor(() => renderedStatus.untracked === 1);
      const rendersAfterSettle = renders;
      await tick(60);
      assert.equal(renders, rendersAfterSettle, "no timer, so no further reads");
      refresher.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
