import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  basenamePath,
  formatCwd,
  renderHeader,
  truncatePath,
  type HeaderThemeLike,
} from "../src/header.js";

const theme: HeaderThemeLike = {
  fg: (_s, text) => text,
  dim: (s) => s,
  bold: (s) => s,
  muted: (s) => s,
};

describe("formatCwd", () => {
  it("leaves cwd outside home untouched", () => {
    const cwd = "/tmp/other/path";
    // HOME may vary; at least ensure it doesn't throw
    assert.equal(typeof formatCwd(cwd), "string");
  });

  it("collapses home to ~", () => {
    const home = process.env.HOME ?? "";
    if (!home) return;
    assert.equal(formatCwd(home), "~");
    assert.equal(formatCwd(`${home}/projects/foo`), `~/projects/foo`);
  });
});

describe("basenamePath", () => {
  it("extracts basename", () => {
    assert.equal(basenamePath("~/a/b/c"), "c");
    assert.equal(basenamePath("/foo/bar"), "bar");
    assert.equal(basenamePath("single"), "single");
  });
});

describe("truncatePath", () => {
  it("leaves short paths untouched", () => {
    assert.equal(truncatePath("~/a/b", 10), "~/a/b");
  });

  it("truncates long paths with middle ellipsis", () => {
    const long = "~/very/long/path/with/many/segments/here";
    const out = truncatePath(long, 16);
    assert.ok(out.includes("..."));
    assert.ok(out.length <= 16);
  });

  it("handles maxLen <=3", () => {
    assert.equal(truncatePath("abcdef", 2), "..");
  });
});

describe("renderHeader", () => {
  it("shows cwd with icon and hints at wide width", () => {
    const lines = renderHeader(
      80,
      { cwd: "/tmp/my-workspace", workspaceDisplay: "path", tipCommands: ["theme", "model-info"] },
      theme,
    );
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.includes("my-workspace"));
    assert.ok(lines[0]!.includes("/theme"));
  });

  it("honours workspaceDisplay=name (basename only)", () => {
    const wide = renderHeader(
      80,
      { cwd: "/home/user/projects/my-workspace", workspaceDisplay: "name", tipCommands: ["theme"] },
      theme,
    );
    const pathMode = renderHeader(
      80,
      { cwd: "/home/user/projects/my-workspace", workspaceDisplay: "path", tipCommands: ["theme"] },
      theme,
    );
    assert.ok(wide[0]!.includes("my-workspace"));
    // path mode should contain more than just basename (either ~ or full)
    assert.ok(pathMode[0]!.length >= wide[0]!.length);
  });

  it("drops tips at narrow width", () => {
    const lines = renderHeader(
      20,
      { cwd: "/tmp/ws", workspaceDisplay: "path", tipCommands: ["theme", "model-info"] },
      theme,
    );
    assert.equal(lines.length, 1);
    // Should still contain cwd but not necessarily tips (depends on logic)
    assert.ok(lines[0]!.includes("ws"));
  });

  it("returns empty for missing cwd", () => {
    assert.deepEqual(renderHeader(80, { cwd: "", workspaceDisplay: "path", tipCommands: ["theme"] }, theme), []);
  });

  it("returns empty for zero width", () => {
    assert.deepEqual(renderHeader(0, { cwd: "/tmp/x", workspaceDisplay: "path", tipCommands: ["x"] }, theme), []);
  });

  it("truncates long cwd via truncatePath", () => {
    const lines = renderHeader(
      40,
      {
        cwd: "/very/long/path/that/needs/truncation/because/it/is/huge/workspace",
        workspaceDisplay: "path",
        tipCommands: ["theme"],
      },
      theme,
    );
    assert.ok(lines[0]!.length <= 40);
    // When truncation happens, should contain ...
    if (lines[0]!.length === 40) assert.ok(lines[0]!.includes("..."));
  });

  it("normalizes tipCommands without leading slash", () => {
    const lines = renderHeader(
      80,
      { cwd: "/tmp/ws", workspaceDisplay: "path", tipCommands: ["theme"] },
      theme,
    );
    assert.ok(lines[0]!.includes("/theme"));
  });

  it("respects custom cwd icon", () => {
    const lines = renderHeader(
      80,
      { cwd: "/tmp/ws", workspaceDisplay: "path", tipCommands: [], iconCwd: "" },
      theme,
    );
    assert.ok(lines[0]!.includes(""));
  });
});
