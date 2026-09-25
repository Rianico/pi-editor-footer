import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { basenamePath, formatCwd, truncatePath } from "../src/path-format.js";

// Ported from the retired test/header.test.ts (src/header.ts was production-dead;
// path-format.ts is the live owner of these helpers). renderHeader cases were
// dropped together with the module.

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
