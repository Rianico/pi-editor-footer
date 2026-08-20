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
    assert.ok(nerd.git);
    assert.ok(ascii.git);
    assert.notEqual(nerd.git, ascii.git);
  });

  test("runtimeSymbol returns symbols", () => {
    assert.equal(runtimeSymbol("nodejs", "ascii"), "node");
    assert.ok(runtimeSymbol("nodejs", "nerd").length > 0);
    assert.equal(runtimeSymbol("unknown-xyz", "ascii"), "unknown-xyz");
  });
});
