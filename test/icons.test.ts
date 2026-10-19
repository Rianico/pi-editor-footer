import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveGlyphs, resolveIconMode, runtimeSymbol } from "../src/icons.js";

describe("icons", () => {
  test("resolveIconMode respects explicit modes", () => {
    assert.equal(resolveIconMode("nerd"), "nerd");
    assert.equal(resolveIconMode("ascii"), "ascii");
  });

  test("resolveGlyphs returns glyphs", () => {
    const nerd = resolveGlyphs("nerd");
    const ascii = resolveGlyphs("ascii");
    assert.ok(nerd.git.length > 0, "nerd keeps the branch icon");
    // ADR-0003: p10k's ascii set has no branch icon, which also clears the collision
    // between the old ascii `*` and a dirty marker.
    assert.equal(ascii.git, "");
    assert.ok(ascii.staged.length > 0);
    assert.ok(ascii.unstaged.length > 0);
    assert.ok(ascii.untracked.length > 0);
    assert.ok(ascii.ahead.length > 0);
    assert.ok(ascii.behind.length > 0);
    assert.ok(ascii.stashed.length > 0);
  });

  test("runtimeSymbol returns symbols", () => {
    assert.equal(runtimeSymbol("nodejs", "ascii"), "node");
    assert.ok(runtimeSymbol("nodejs", "nerd").length > 0);
    assert.equal(runtimeSymbol("unknown-xyz", "ascii"), "unknown-xyz");
  });
});
