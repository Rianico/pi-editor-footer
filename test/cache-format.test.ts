import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeCacheHitPercent } from "../src/cache-math.js";
import {
  formatInt,
  formatPercent,
  formatTotalsLine,
  shortModelName,
  summarizeHitPercent,
} from "../src/cache-format.js";
import type { CacheUsageTotals } from "../src/cache-types.js";

function makeTotals(overrides: Partial<CacheUsageTotals> = {}): CacheUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    assistantMessages: 0,
    ...overrides,
  };
}

describe("formatInt", () => {
  test("formats a small integer with no separator", () => {
    assert.equal(formatInt(42), "42");
  });

  test("formats thousands with a comma separator", () => {
    assert.equal(formatInt(1000), "1,000");
    assert.equal(formatInt(1_234_567), "1,234,567");
  });

  test("rounds fractional values to nearest integer", () => {
    assert.equal(formatInt(3.4), "3");
    assert.equal(formatInt(3.6), "4");
  });

  test("handles zero", () => {
    assert.equal(formatInt(0), "0");
  });
});

describe("formatPercent", () => {
  test("always shows exactly one decimal place", () => {
    assert.equal(formatPercent(50), "50.0%");
    assert.equal(formatPercent(0), "0.0%");
    assert.equal(formatPercent(100), "100.0%");
  });

  test("rounds to one decimal place", () => {
    assert.equal(formatPercent(33.333), "33.3%");
    assert.equal(formatPercent(66.666), "66.7%");
  });
});

describe("shortModelName", () => {
  test("concatenates provider and model with a slash", () => {
    assert.equal(shortModelName("anthropic", "claude-3"), "anthropic/claude-3");
  });

  test("works with empty strings", () => {
    assert.equal(shortModelName("", "gpt-4"), "/gpt-4");
  });
});

describe("summarizeHitPercent", () => {
  test("returns 0 for all-zero totals", () => {
    assert.equal(summarizeHitPercent(makeTotals()), 0);
  });

  test("matches the result of calling computeCacheHitPercent directly", () => {
    const totals = makeTotals({ input: 100, cacheRead: 200, cacheWrite: 50 });
    const direct = computeCacheHitPercent(totals.input, totals.cacheRead, totals.cacheWrite);
    assert.ok(Math.abs(summarizeHitPercent(totals) - direct) < 1e-10);
  });

  test("returns 100 when all tokens are cache reads", () => {
    assert.equal(summarizeHitPercent(makeTotals({ cacheRead: 500 })), 100);
  });

  test("returns a value between 0 and 100 for partial cache hit", () => {
    const result = summarizeHitPercent(makeTotals({ input: 50, cacheRead: 50 }));
    assert.ok(result > 0);
    assert.ok(result < 100);
  });
});

describe("formatTotalsLine", () => {
  test("contains the label, turns, and hit rate", () => {
    const line = formatTotalsLine("Branch", makeTotals({ assistantMessages: 3 }));
    assert.ok(line.includes("Branch"));
    assert.ok(line.includes("turns"));
    assert.ok(line.includes("hit rate"));
    assert.ok(line.includes("3"));
  });

  test("contains formatted assistant-message count", () => {
    const line = formatTotalsLine("Label", makeTotals({ assistantMessages: 1234 }));
    assert.ok(line.includes("1,234"));
  });

  test("contains the cache hit % as a formatted percent", () => {
    // 100 cacheRead out of 200 total prompt = 50%
    const totals = makeTotals({ input: 100, cacheRead: 100, cacheWrite: 0 });
    const line = formatTotalsLine("Scope", totals);
    assert.ok(line.includes("50.0%"));
  });
});
