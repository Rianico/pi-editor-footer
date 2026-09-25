import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeCumulativeSeries } from "../src/cache-cumulative.js";
import { computeCacheHitPercent } from "../src/cache-math.js";
import type { AssistantUsageMetric } from "../src/cache-types.js";

function makeMetric(
  seq: number,
  input: number,
  cacheRead: number,
  cacheWrite: number,
): AssistantUsageMetric {
  return {
    sequence: seq,
    entryId: `e${seq}`,
    timestamp: "2024-01-01T00:00:00.000Z",
    provider: "anthropic",
    model: "claude-3",
    input,
    output: 10,
    cacheRead,
    cacheWrite,
    totalTokens: input + cacheRead + cacheWrite + 10,
    cacheHitPercent: computeCacheHitPercent(input, cacheRead, cacheWrite),
    isOnActiveBranch: true,
  };
}

describe("computeCumulativeSeries", () => {
  test("returns empty arrays for empty input", () => {
    const series = computeCumulativeSeries([]);
    assert.deepEqual(series, {
      cumInput: [],
      cumCacheRead: [],
      cumCacheWrite: [],
      cumHitPercent: [],
    });
  });

  test("single message: cumulative equals its own values", () => {
    const series = computeCumulativeSeries([makeMetric(1, 100, 200, 50)]);
    assert.deepEqual(series.cumInput, [100]);
    assert.deepEqual(series.cumCacheRead, [200]);
    assert.deepEqual(series.cumCacheWrite, [50]);
    assert.ok(Math.abs(series.cumHitPercent[0]! - (200 / 350) * 100) < 1e-9);
  });

  test("running sums accumulate across messages", () => {
    const series = computeCumulativeSeries([
      makeMetric(1, 100, 200, 0),
      makeMetric(2, 50, 100, 50),
      makeMetric(3, 200, 300, 100),
    ]);
    assert.deepEqual(series.cumInput, [100, 150, 350]);
    assert.deepEqual(series.cumCacheRead, [200, 300, 600]);
    assert.deepEqual(series.cumCacheWrite, [0, 50, 150]);
  });

  test("cumHitPercent follows the canonical formula on running sums", () => {
    const messages = [makeMetric(1, 100, 200, 0), makeMetric(2, 50, 100, 50)];
    const series = computeCumulativeSeries(messages);
    assert.ok(Math.abs(series.cumHitPercent[0]! - computeCacheHitPercent(100, 200, 0)) < 1e-9);
    assert.ok(Math.abs(series.cumHitPercent[1]! - computeCacheHitPercent(150, 300, 50)) < 1e-9);
  });
});
