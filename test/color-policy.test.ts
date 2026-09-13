import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONTEXT_TIER_HEX,
  CONTEXT_TIER_THEME_COLOR,
  contextUsageTier,
} from "../src/color-policy.js";

const ONE_M = 1_000_000;
const SMALL = 200_000;

describe("color-policy context tiers", () => {
  test("1M window: 12.5 / 25 % alarm steps", () => {
    assert.equal(contextUsageTier(0, ONE_M), "ok");
    assert.equal(contextUsageTier(12.4, ONE_M), "ok");
    assert.equal(contextUsageTier(12.5, ONE_M), "warn");
    assert.equal(contextUsageTier(24.9, ONE_M), "warn");
    assert.equal(contextUsageTier(25, ONE_M), "critical");
    assert.equal(contextUsageTier(80, ONE_M), "critical");
  });

  test("smaller window: 25 / 50 % alarm steps", () => {
    assert.equal(contextUsageTier(0, SMALL), "ok");
    assert.equal(contextUsageTier(24.9, SMALL), "ok");
    assert.equal(contextUsageTier(25, SMALL), "warn");
    assert.equal(contextUsageTier(49.9, SMALL), "warn");
    assert.equal(contextUsageTier(50, SMALL), "critical");
  });

  test("unknown window (0) keeps the looser small-window steps", () => {
    assert.equal(contextUsageTier(12.5, 0), "ok");
    assert.equal(contextUsageTier(25, 0), "warn");
    assert.equal(contextUsageTier(50, 0), "critical");
  });

  test("tier palette is the fixed nord green/amber/dark red hex", () => {
    assert.deepEqual(CONTEXT_TIER_HEX, {
      ok: "#A3BE8C",
      warn: "#EBCB8B",
      critical: "#9A3939",
    });
  });

  test("every tier has a semantic fallback token", () => {
    assert.equal(CONTEXT_TIER_THEME_COLOR.ok, "success");
    assert.equal(CONTEXT_TIER_THEME_COLOR.warn, "warning");
    assert.equal(CONTEXT_TIER_THEME_COLOR.critical, "error");
  });
});
