import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addToTotals,
  computeCacheHitPercent,
  emptyTotals,
  promptTokens,
} from "../src/cache-math.js";
import {
  formatInt,
  formatPercent,
  promptTokensOfTotals,
  summarizeHitPercent,
} from "../src/cache-format.js";
import { buildCsv } from "../src/cache-export.js";
import { collectCacheSessionMetrics } from "../src/cache-session-data.js";
import { renderStatsBody } from "../src/cache-stats-view.js";
import { getUsageTotals, invalidateUsageCache, totalInputTokens } from "../src/state.js";
import type {
  AssistantUsageMetric,
  CacheSessionEntryLike,
  CacheUsageTotals,
} from "../src/cache-types.js";

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

describe("promptTokens", () => {
  test("sums the three prompt components", () => {
    assert.equal(promptTokens(100, 200, 10), 310);
  });

  test("is zero only when all components are zero", () => {
    assert.equal(promptTokens(0, 0, 0), 0);
    assert.ok(promptTokens(1, 0, 0) > 0);
    assert.ok(promptTokens(0, 1, 0) > 0);
    assert.ok(promptTokens(0, 0, 1) > 0);
  });

  test("gate boundary: separates no-prompt from a genuine 0% hit (hand-pinned constants)", () => {
    // Callers (state.ts:getUsageTotals) gate on promptTokens > 0 *before*
    // trusting the percent, so the gate and the zero-hit value must differ:
    // an uncached-only prompt has a positive denominator yet a 0% hit.
    assert.equal(promptTokens(0, 0, 0), 0); // 0 + 0 + 0 — gate closed
    assert.equal(computeCacheHitPercent(0, 0, 0), 0); // zero-denominator sentinel
    assert.equal(promptTokens(10, 0, 0), 10); // 10 + 0 + 0 — gate open
    assert.equal(computeCacheHitPercent(10, 0, 0), 0); // 0/10*100 — real 0% hit
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

// Characterization: the prompt-total denominator `input + cacheRead + cacheWrite`
// and the hit formula `cacheRead / promptTotal * 100` are hand-copied in five
// places (cache-math, state, cache-format, cache-export, cache-stats-view).
// These tests pin all five sites to the claimed owner `computeCacheHitPercent`
// so any drift between copies is caught. Expected values below are plain
// arithmetic, independent of any of the five implementations.
describe("prompt-token formula parity across all five call sites", () => {
  // input 100, cacheRead 200, cacheWrite 10 → prompt total 310, hit 200/310.
  const U = { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, totalTokens: 360 };
  const EXPECTED_PROMPT = 310; // 100 + 200 + 10
  const EXPECTED_HIT = (200 / 310) * 100;

  function assistantEntry(usage: typeof U): CacheSessionEntryLike {
    return {
      type: "message",
      id: "e1",
      timestamp: "2024-06-01T12:00:00.000Z",
      message: { role: "assistant", provider: "anthropic", model: "claude-3", usage },
    };
  }

  test("cache-math owner: fixed arithmetic values", () => {
    assert.ok(
      Math.abs(computeCacheHitPercent(U.input, U.cacheRead, U.cacheWrite) - EXPECTED_HIT) < 1e-12,
    );
  });

  test("state.getUsageTotals latestCacheHitRate equals the owner for the same usage", () => {
    invalidateUsageCache();
    const totals = getUsageTotals({
      sessionManager: { getEntries: () => [assistantEntry(U)] },
    });
    assert.equal(
      totals.latestCacheHitRate,
      computeCacheHitPercent(U.input, U.cacheRead, U.cacheWrite),
    );
    assert.equal(totals.latestCacheHitRate, EXPECTED_HIT);
    // state.totalInputTokens uses the same denominator as the owner.
    assert.equal(totalInputTokens(totals), EXPECTED_PROMPT);
    assert.equal(totalInputTokens(totals), promptTokens(U.input, U.cacheRead, U.cacheWrite));
    assert.equal(totalInputTokens(totals), promptTokensOfTotals(totals));
  });

  test("cache-format promptTokensOfTotals and summarizeHitPercent equal the owner", () => {
    const totals: CacheUsageTotals = {
      ...emptyTotals(),
      input: U.input,
      cacheRead: U.cacheRead,
      cacheWrite: U.cacheWrite,
    };
    assert.equal(promptTokensOfTotals(totals), EXPECTED_PROMPT);
    assert.equal(
      summarizeHitPercent(totals),
      computeCacheHitPercent(U.input, U.cacheRead, U.cacheWrite),
    );
  });

  test("cache-export prompt_tokens cells equal the owner denominator", () => {
    const metrics = collectCacheSessionMetrics({
      getEntries: () => [assistantEntry(U)],
      getBranch: () => [assistantEntry(U)],
    });
    const lines = buildCsv(metrics).split("\n");
    const header = lines[0]!.split(",");
    const promptIdx = header.indexOf("prompt_tokens");
    assert.ok(promptIdx >= 0);
    for (const line of lines.slice(1)) {
      if (!line.startsWith("summary,") && !line.startsWith("message,")) continue;
      // Summary scope column distinguishes rows; delta row has no prompt_tokens.
      const cell = Number(line.split(",")[promptIdx]);
      const scopeOrType = line.startsWith("message,") ? "message" : line.split(",")[1];
      if (scopeOrType === "delta_tree_minus_branch") continue;
      assert.equal(cell, EXPECTED_PROMPT, `prompt_tokens for ${scopeOrType}`);
    }
  });

  test("cache-stats-view rendered prompt and hit columns equal the owner", () => {
    const metrics = collectCacheSessionMetrics({
      getEntries: () => [assistantEntry(U)],
      getBranch: () => [assistantEntry(U)],
    });
    const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
    const lines = renderStatsBody(theme, metrics, 80);
    const messageRow = lines.find((l) => l.trimStart().startsWith("1 "));
    assert.ok(messageRow, "per-message row rendered");
    assert.ok(messageRow.includes(formatInt(EXPECTED_PROMPT)), "prompt column = owner denominator");
    assert.ok(
      messageRow.includes(formatPercent(EXPECTED_HIT)),
      "hit% column equals owner formula via cache-session-data",
    );
    const branchLine = lines.find((l) => l.startsWith("Active branch:"));
    assert.ok(branchLine);
    assert.ok(branchLine.includes(`prompt ${formatInt(EXPECTED_PROMPT)}`));
    assert.ok(branchLine.includes(`hit rate ${formatPercent(EXPECTED_HIT)}`));
  });
});
