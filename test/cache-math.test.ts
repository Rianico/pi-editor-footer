import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addToTotals, computeCacheHitPercent, emptyTotals } from "../src/cache-math.js";
import type { AssistantUsageMetric } from "../src/cache-types.js";

describe("computeCacheHitPercent", () => {
  test("returns 0 when denominator is zero", () => {
    assert.equal(computeCacheHitPercent(0, 0, 0), 0);
  });

  test("returns 100 when everything is a cache hit (all cacheRead, no input or cacheWrite)", () => {
    assert.equal(computeCacheHitPercent(0, 500, 0), 100);
  });

  test("handles Anthropic-style: input is fresh portion only, cacheWrite is newly cached", () => {
    // denominator = 100 + 200 + 50 = 350; hit = 200/350 * 100
    assert.ok(Math.abs(computeCacheHitPercent(100, 200, 50) - (200 / 350) * 100) < 1e-5);
  });

  test("handles OpenAI-style: cacheWrite is 0, input includes everything", () => {
    // denominator = 400 + 100 + 0 = 500; hit = 100/500 * 100 = 20
    assert.ok(Math.abs(computeCacheHitPercent(400, 100, 0) - 20) < 1e-5);
  });

  test("returns 50% for equal input and cacheRead with no cacheWrite", () => {
    assert.ok(Math.abs(computeCacheHitPercent(50, 50, 0) - 50) < 1e-5);
  });

  test("does not return NaN or Infinity for large values", () => {
    const result = computeCacheHitPercent(1_000_000, 5_000_000, 500_000);
    assert.ok(Number.isFinite(result));
    assert.ok(result > 0);
    assert.ok(result <= 100);
  });
});

describe("emptyTotals", () => {
  test("returns an object with all numeric fields set to 0", () => {
    const totals = emptyTotals();
    assert.deepEqual(totals, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      assistantMessages: 0,
    });
  });

  test("returns a new object each time (no shared reference)", () => {
    const a = emptyTotals();
    const b = emptyTotals();
    a.input = 999;
    assert.equal(b.input, 0);
  });
});

function makeMetric(overrides: Partial<AssistantUsageMetric> = {}): AssistantUsageMetric {
  return {
    sequence: 1,
    entryId: "e1",
    timestamp: "2024-01-01T00:00:00.000Z",
    provider: "anthropic",
    model: "claude-3",
    input: 100,
    output: 50,
    cacheRead: 200,
    cacheWrite: 10,
    totalTokens: 360,
    cacheHitPercent: 57.14,
    isOnActiveBranch: true,
    ...overrides,
  };
}

describe("addToTotals", () => {
  test("accumulates a single message into empty totals", () => {
    const totals = emptyTotals();
    addToTotals(totals, makeMetric());

    assert.equal(totals.input, 100);
    assert.equal(totals.output, 50);
    assert.equal(totals.cacheRead, 200);
    assert.equal(totals.cacheWrite, 10);
    assert.equal(totals.totalTokens, 360);
    assert.equal(totals.assistantMessages, 1);
  });

  test("accumulates two messages by summing all fields", () => {
    const totals = emptyTotals();
    addToTotals(
      totals,
      makeMetric({ input: 100, output: 50, cacheRead: 200, cacheWrite: 10, totalTokens: 360 }),
    );
    addToTotals(
      totals,
      makeMetric({ input: 200, output: 80, cacheRead: 100, cacheWrite: 20, totalTokens: 400 }),
    );

    assert.equal(totals.input, 300);
    assert.equal(totals.output, 130);
    assert.equal(totals.cacheRead, 300);
    assert.equal(totals.cacheWrite, 30);
    assert.equal(totals.totalTokens, 760);
    assert.equal(totals.assistantMessages, 2);
  });

  test("does not mutate the message argument", () => {
    const totals = emptyTotals();
    const msg = makeMetric({ input: 100 });
    addToTotals(totals, msg);
    assert.equal(msg.input, 100);
  });
});
