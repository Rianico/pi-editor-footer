import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyGitStatus } from "../src/git.js";
import { composeGitRail, renderGitSegment } from "../src/footer.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { IconGlyphs } from "../src/icons.js";
import { resolveGlyphs } from "../src/icons.js";

const NERD = resolveGlyphs("nerd");
const ASCII = resolveGlyphs("ascii");
const SEGMENTS = DEFAULT_CONFIG.footerSegments;

/** nerd prefixes the branch with its icon, so expectations derive from the glyph set. */
function rail(
  partial: Partial<ReturnType<typeof emptyGitStatus>>,
  mode: "nerd" | "ascii" = "nerd",
  action = "",
  segments = SEGMENTS,
): string {
  const git = { ...emptyGitStatus(), ...partial };
  return composeGitRail(git, mode === "nerd" ? NERD : ASCII, segments, action)
    .map((p) => p.text)
    .join(" ");
}

const nerdBranch = `${NERD.git} main`;
const theme = { fg: (_style: string, text: string) => text };

describe("git rail — powerlevel10k composition (ADR-0003)", () => {
  test("clean branch is the branch alone", () => {
    assert.equal(rail({ branch: "main" }), nerdBranch);
    assert.equal(rail({ branch: "main" }, "ascii"), "main", "p10k's ascii set has no branch icon");
  });

  test("staged, unstaged and untracked render in ADR order, count 1 suppressed", () => {
    assert.equal(
      rail({ branch: "main", staged: 2, unstaged: 1, untracked: 4 }),
      `${nerdBranch} +2 ! ?4`,
    );
  });

  test("behind precedes ahead", () => {
    assert.equal(
      rail({ branch: "main", behind: 1, ahead: 2 }),
      `${nerdBranch} ${NERD.behind} ${NERD.ahead}2`,
    );
  });

  test("stash always carries its count, even at 1", () => {
    assert.equal(rail({ branch: "main", stashed: 1 }), `${nerdBranch} ${NERD.stashed}1`);
  });

  test("all parts compose with no brackets", () => {
    assert.equal(
      rail({
        branch: "main",
        staged: 2,
        unstaged: 1,
        untracked: 3,
        behind: 1,
        ahead: 2,
        stashed: 1,
      }),
      `${nerdBranch} +2 ! ?3 ${NERD.behind} ${NERD.ahead}2 ${NERD.stashed}1`,
    );
  });

  test("conflicts are colour-only: no glyph, no count, branch painted error", () => {
    const git = { ...emptyGitStatus(), branch: "main", unmerged: 3 };
    const parts = composeGitRail(git, NERD, SEGMENTS);
    assert.equal(parts.length, 1, "no conflict glyph and no count");
    assert.equal(parts[0]?.text, nerdBranch);
    assert.equal(parts[0]?.color, "error");
  });

  test("detached shows the commit and its tag", () => {
    const detached = {
      ...emptyGitStatus(),
      commit: { oid: "9f2c1a8bdeadbeefdeadbeefdeadbeefdeadbeef", detached: true, tag: "v0.13.0" },
    };
    assert.equal(rail(detached), "9f2c1a8b v0.13.0");
  });

  test("tags render only while detached", () => {
    const onBranch = {
      ...emptyGitStatus(),
      branch: "main",
      commit: { oid: "9f2c1a8bdeadbeefdeadbeefdeadbeefdeadbeef", detached: false, tag: "v0.13.0" },
    };
    assert.equal(rail(onBranch), nerdBranch);
  });

  test("gitCommit hides the detached commit+tag; gitBranch gates the branch", () => {
    const git = {
      ...emptyGitStatus(),
      commit: { oid: "9f2c1a8bdeadbeefdeadbeefdeadbeefdeadbeef", detached: true, tag: "v0.13.0" },
    };
    assert.equal(composeGitRail(git, NERD, { ...SEGMENTS, gitCommit: false }).length, 0);
    assert.equal(
      composeGitRail({ ...git, branch: "main" }, NERD, { ...SEGMENTS, gitBranch: false }).length,
      0,
    );
  });

  test("gitStatus toggle drops counts but keeps the branch", () => {
    assert.equal(
      rail({ branch: "main", staged: 2 }, "nerd", "", { ...SEGMENTS, gitStatus: false }),
      nerdBranch,
    );
  });

  test("a live action suppresses the counts and appends the label", () => {
    assert.equal(
      rail(
        { branch: "main", staged: 2, unstaged: 1, untracked: 3, behind: 1, ahead: 2, stashed: 1 },
        "nerd",
        "MERGING",
      ),
      `${nerdBranch} |MERGING`,
      "during an operation the counts are the operation's own churn",
    );
  });

  test("action is uppercased into git-prompt.sh vocabulary", () => {
    assert.equal(rail({ branch: "main" }, "nerd", "rebase 2/7"), `${nerdBranch} |REBASE 2/7`);
  });

  test("ascii uses the ascii glyph vocabulary and no branch icon", () => {
    assert.equal(
      rail({ branch: "main", staged: 2, behind: 1, ahead: 2, stashed: 1 }, "ascii"),
      "main A2 v ^2 S1",
    );
  });

  test("not a git repo renders (no git)", () => {
    assert.equal(rail({}), "(no git)");
  });

  test("renderGitSegment paints through the theme and single-space joins", () => {
    const git = { ...emptyGitStatus(), branch: "main", staged: 2, unstaged: 1 };
    const out = renderGitSegment(theme, git, ASCII, SEGMENTS);
    assert.equal(out, "main A2 !");
    assert.ok(!out.includes("["), "no brackets");
    assert.ok(!out.includes("  "), "single-space separated");
  });
});
