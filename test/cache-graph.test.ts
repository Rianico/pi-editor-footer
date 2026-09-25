import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  averageHitPercent,
  bucketMessages,
  maxHitPercent,
  minHitPercent,
} from "../src/cache-graph-view.js";
import type { AssistantUsageMetric } from "../src/cache-types.js";

function makeMetric(cacheHitPercent: number, seq = 1): AssistantUsageMetric {
  return {
    sequence: seq,
    entryId: `e${seq}`,
    timestamp: "2024-01-01T00:00:00.000Z",
    provider: "anthropic",
    model: "claude-3",
    input: 100,
    output: 50,
    cacheRead: 200,
    cacheWrite: 10,
    totalTokens: 360,
    cacheHitPercent,
    isOnActiveBranch: true,
  };
}

describe("bucketMessages", () => {
  test("returns empty array for empty input", () => {
    assert.equal(bucketMessages([], 5).length, 0);
  });

  test("puts each message in its own bucket when count ≤ bucketCount", () => {
    const msgs = [makeMetric(10, 1), makeMetric(20, 2), makeMetric(30, 3)];
    const buckets = bucketMessages(msgs, 5);
    assert.equal(buckets.length, 3);
    assert.equal(buckets[0]?.length, 1);
    assert.equal(buckets[0]?.[0]?.sequence, 1);
  });

  test("returns exactly bucketCount buckets when messages > bucketCount", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMetric(i * 5, i + 1));
    assert.equal(bucketMessages(msgs, 7).length, 7);
  });

  test("covers all messages with no duplicates or omissions", () => {
    const msgs = Array.from({ length: 15 }, (_, i) => makeMetric(i * 5, i + 1));
    const buckets = bucketMessages(msgs, 4);
    const allInBuckets = buckets.flat();
    assert.equal(allInBuckets.length, msgs.length);
    const seqs = allInBuckets.map((m) => m.sequence).sort((a, b) => a - b);
    assert.deepEqual(
      seqs,
      msgs.map((m) => m.sequence),
    );
  });

  test("returns one bucket with one message when there is one message and many bucket slots", () => {
    const buckets = bucketMessages([makeMetric(55, 1)], 50);
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]?.length, 1);
  });
});

describe("averageHitPercent", () => {
  test("returns 0 for empty array", () => {
    assert.equal(averageHitPercent([]), 0);
  });

  test("returns the single message's cacheHitPercent", () => {
    assert.equal(averageHitPercent([makeMetric(42)]), 42);
  });

  test("returns the arithmetic mean for multiple messages", () => {
    assert.ok(
      Math.abs(averageHitPercent([makeMetric(20), makeMetric(40), makeMetric(60)]) - 40) < 1e-5,
    );
  });

  test("handles all-zero hit percents", () => {
    assert.equal(averageHitPercent([makeMetric(0), makeMetric(0)]), 0);
  });
});

describe("minHitPercent / maxHitPercent", () => {
  const msgs = [makeMetric(30), makeMetric(10), makeMetric(50)];

  test("empty array returns 0", () => {
    assert.equal(minHitPercent([]), 0);
    assert.equal(maxHitPercent([]), 0);
  });

  test("single message returns its percent", () => {
    assert.equal(minHitPercent([makeMetric(77)]), 77);
    assert.equal(maxHitPercent([makeMetric(33)]), 33);
  });

  test("returns smallest / largest across multiple messages", () => {
    assert.equal(minHitPercent(msgs), 10);
    assert.equal(maxHitPercent(msgs), 50);
  });
});
