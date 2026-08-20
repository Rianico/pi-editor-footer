import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  basenamePath,
  fitSegmentsByPriority,
  formatCwd,
  formatDuration,
  fmtTokens,
  truncateBranch,
  truncatePath,
} from "../src/utils.js";

const theme = { fg: (_s: string, t: string) => t };

describe("utils", () => {
  test("basenamePath extracts last segment", () => {
    assert.equal(basenamePath("/a/b/c"), "c");
    assert.equal(basenamePath("~/.pi/agent"), "agent");
    assert.equal(basenamePath("single"), "single");
  });

  test("truncateBranch keeps prefix", () => {
    assert.equal(truncateBranch("fix/login", 20), "fix/login");
    assert.equal(truncateBranch("a".repeat(30), 10), "a".repeat(7) + "...");
  });

  test("truncatePath keeps head and tail", () => {
    assert.equal(truncatePath("/a/b/c", 20), "/a/b/c");
    const long = "~/a/b/c/d/e/f/g";
    const truncated = truncatePath(long, 10);
    assert.ok(truncated.length <= 10);
    assert.ok(truncated.includes("..."));
  });

  test("fmtTokens formats", () => {
    assert.equal(fmtTokens(999), "999");
    assert.equal(fmtTokens(1500), "1.5k");
    assert.equal(fmtTokens(15000), "15k");
  });

  test("formatDuration", () => {
    assert.equal(formatDuration(500), "0s");
    assert.equal(formatDuration(65000), "1m 5s");
    assert.equal(formatDuration(3700000), "1h 1m 40s");
  });
  test("formatCwd relative to HOME", () => {
    const cwd = formatCwd("/tmp");
    assert.ok(typeof cwd === "string");
  });

  test("fitSegmentsByPriority compacts and drops", () => {
    const segs = [
      { text: "cwd", priority: 0 },
      { text: "git", priority: 3 },
      { text: "runtime", priority: 4 },
    ];
    const fitted = fitSegmentsByPriority(segs, 20, "...");
    assert.ok(fitted.length > 0);
    const narrow = fitSegmentsByPriority(segs, 3, "...");
    assert.ok(narrow.length <= segs.length);
  });

  test("fitSegmentsByPriority uses compactText", () => {
    const segs = [
      { text: "~/very/long/path/to/project", compactText: "project", priority: 4 },
      { text: "git: main", priority: 0 },
    ];
    const fitted = fitSegmentsByPriority(segs, 15, "...");
    assert.ok(fitted.some((s) => s.includes("project")));
  });
});
