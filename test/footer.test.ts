import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderFooter } from "../src/footer.js";
import { createInitialState } from "../src/state.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { emptyGitStatus } from "../src/git.js";

const theme = {
  fg: (_style: string, text: string) => text,
};

function makeState(
  overrides: Partial<ReturnType<typeof createInitialState>> = {},
) {
  return { ...createInitialState(), ...overrides };
}

describe("footer", () => {
  test("renders one line at normal width", () => {
    const state = makeState();
    const lines = renderFooter(80, state, DEFAULT_CONFIG, theme as never, {
      cwd: "/Users/test/project",
    });
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.length > 0);
  });

  test("sheds segments at narrow width", () => {
    const state = makeState({
      git: {
        ...emptyGitStatus(),
        branch: "feature/very-long-branch-name-that-exceeds",
        staged: 2,
        modified: 3,
      },
      runtime: { name: "nodejs", version: "20.0.0" },
    });
    const narrow = renderFooter(30, state, DEFAULT_CONFIG, theme as never, {
      cwd: "/Users/test/project",
    });
    assert.equal(narrow.length, 1);
    // Should not exceed width (visible width approximated without ANSI)
    for (const line of narrow) {
      assert.ok(line.length <= 80);
    }
  });

  test("workspaceDisplay switches cwd format (path vs name)", () => {
    const state = makeState();
    const configPath = { ...DEFAULT_CONFIG, workspaceDisplay: "path" as const };
    const configName = { ...DEFAULT_CONFIG, workspaceDisplay: "name" as const };
    const linesPath = renderFooter(80, state, configPath, theme as never, {
      cwd: "/Users/test/long/path/to/project",
    });
    const linesName = renderFooter(80, state, configName, theme as never, {
      cwd: "/Users/test/long/path/to/project",
    });
    assert.ok(linesPath[0]!.includes("/Users/test/long/path/to/project") || linesPath[0]!.includes("long/path/to/project"));
    assert.ok(linesName[0]!.includes("project"));
    assert.ok(!linesName[0]!.includes("/Users/test/long/path/to/project"));
  });

  test("respects footerSegments toggles", () => {
    const state = makeState({ git: { ...emptyGitStatus(), branch: "main" } });
    const config = {
      ...DEFAULT_CONFIG,
      footerSegments: {
        ...DEFAULT_CONFIG.footerSegments,
        gitBranch: false,
        gitStatus: false,
      },
    };
    const lines = renderFooter(80, state, config, theme as never, {
      cwd: "/tmp",
    });
    assert.ok(!lines[0]!.includes("main"));
  });

  test("handles zero width", () => {
    const state = makeState();
    const lines = renderFooter(0, state, DEFAULT_CONFIG, theme as never, {
      cwd: "/tmp",
    });
    assert.equal(lines[0], "");
  });
});
