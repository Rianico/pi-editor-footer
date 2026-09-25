import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  averageHitPercent,
  bucketMessages,
  maxHitPercent,
  minHitPercent,
} from "../src/cache-graph-view.js";
import { renderStatsBody } from "../src/cache-stats-view.js";
import type {
  AssistantUsageMetric,
  CacheSessionMetrics,
  CacheTheme,
  CacheUsageTotals,
} from "../src/cache-types.js";
import { padLeft, padRight, stripAnsi, visibleWidth } from "../src/layout.js";

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

// ─── Stats table width math (layout-owned padRight/padLeft/truncateToWidth) ───

const plainTheme: CacheTheme = {
  fg: (_style: string, text: string) => text,
  bold: (text: string) => text,
};

function makeTotals(): CacheUsageTotals {
  return {
    input: 100,
    output: 50,
    cacheRead: 200,
    cacheWrite: 10,
    totalTokens: 360,
    assistantMessages: 1,
  };
}

function makeMetrics(messages: AssistantUsageMetric[]): CacheSessionMetrics {
  return {
    allMessages: messages,
    activeBranchMessages: messages,
    treeTotals: makeTotals(),
    activeBranchTotals: makeTotals(),
  };
}

function withModel(seq: number, model: string): AssistantUsageMetric {
  return { ...makeMetric(64.5, seq), model };
}

/** Header + data rows of the per-message breakdown (dashes line excluded). */
function statsTableLines(messages: AssistantUsageMetric[]): string[] {
  const lines = renderStatsBody(plainTheme, makeMetrics(messages), 120);
  const headerIdx = lines.findIndex((line) => line.includes("Per-message breakdown"));
  assert.ok(headerIdx >= 0, "breakdown section missing");
  return [lines[headerIdx + 1]!, ...lines.slice(headerIdx + 3)];
}

describe("stats table layout", () => {
  // Golden strings captured from the retired local pad/truncate implementation —
  // the visible (ANSI-stripped) plain-ASCII output must not change. layout's
  // truncateToWidth appends an invisible SGR reset at a real cut, which is the
  // same rendering and consistent with the repo's existing padRight behaviour.
  test("plain-ASCII rows are visually identical to the retired local pad", () => {
    const lines = statsTableLines([
      withModel(1, "claude-3"),
      withModel(2, "anthropic/claude-opus-4-20260805-vision-x"),
    ]).map(stripAnsi);
    assert.equal(
      lines[0],
      "   # B entry    time     model                       prompt      recv       hit     write    hit%",
    );
    assert.equal(
      lines[1],
      "   1 * e1       00:00:00 anthropic/claude-3             310        50       200        10   64.5%",
    );
    assert.equal(
      lines[2],
      "   2 * e2       00:00:00 anthropic/anthropic/cla…       310        50       200        10   64.5%",
    );
  });

  test("CJK and overlong models keep every row on the same visible width", () => {
    const lines = statsTableLines([
      withModel(1, "claude-3"),
      withModel(2, "anthropic/claude-opus-4-20260805-vision-x"),
      withModel(3, "智谱清言-v4"),
    ]);
    const widths = lines.map(visibleWidth);
    assert.equal(
      new Set(widths).size,
      1,
      `rows misaligned (length-based padding?): ${JSON.stringify(widths)}`,
    );
  });

  test("padRight/padLeft pad to visible width, not string length", () => {
    // Falsifiable against the retired `pad` (String.length based): an ANSI-styled
    // cell is 15 code units but 3 columns wide; length padding added no spaces.
    const styled = "\u001b[31mred\u001b[0m";
    assert.equal(visibleWidth(padRight(styled, 6)), 6);
    assert.equal(visibleWidth(padLeft(styled, 6)), 6);
    assert.equal(padRight("abc", 6), "abc   ");
    assert.equal(padLeft("abc", 6), "   abc");
    assert.equal(padLeft("123", 9), "      123");
  });
});
