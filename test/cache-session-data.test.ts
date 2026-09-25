import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeCacheHitPercent, emptyTotals } from "../src/cache-math.js";
import { collectCacheSessionMetrics } from "../src/cache-session-data.js";
import type { BranchAwareSessionEntryReader, SessionEntryLike } from "../src/session-entries.js";

type FakeUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

function makeAssistantEntry(
  id: string,
  usage: FakeUsage,
  opts: { provider?: string; model?: string; timestamp?: string } = {},
): SessionEntryLike {
  return {
    type: "message",
    id,
    timestamp: opts.timestamp ?? "2024-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "claude-3",
      usage,
    },
  };
}

function makeSessionManager(
  entries: SessionEntryLike[],
  branchIds: string[],
): BranchAwareSessionEntryReader {
  return {
    getEntries: () => entries,
    getBranch: () => entries.filter((entry) => branchIds.includes(entry.id ?? "")),
  };
}

describe("collectCacheSessionMetrics — empty session", () => {
  test("returns empty message arrays and zero totals", () => {
    const metrics = collectCacheSessionMetrics(makeSessionManager([], []));

    assert.equal(metrics.allMessages.length, 0);
    assert.equal(metrics.activeBranchMessages.length, 0);
    assert.deepEqual(metrics.treeTotals, emptyTotals());
    assert.deepEqual(metrics.activeBranchTotals, emptyTotals());
  });
});

describe("collectCacheSessionMetrics — single assistant message on active branch", () => {
  const usage: FakeUsage = {
    input: 100,
    output: 50,
    cacheRead: 200,
    cacheWrite: 10,
    totalTokens: 360,
  };
  const entry = makeAssistantEntry("e1", usage);
  const metrics = collectCacheSessionMetrics(makeSessionManager([entry], ["e1"]));

  test("allMessages and activeBranchMessages each have one entry", () => {
    assert.equal(metrics.allMessages.length, 1);
    assert.equal(metrics.activeBranchMessages.length, 1);
  });

  test("metric fields match the source usage", () => {
    const m = metrics.allMessages[0]!;
    assert.equal(m.input, usage.input);
    assert.equal(m.output, usage.output);
    assert.equal(m.cacheRead, usage.cacheRead);
    assert.equal(m.cacheWrite, usage.cacheWrite);
    assert.equal(m.totalTokens, usage.totalTokens);
  });

  test("cacheHitPercent is computed with the canonical formula", () => {
    const m = metrics.allMessages[0]!;
    const expected = computeCacheHitPercent(usage.input, usage.cacheRead, usage.cacheWrite);
    assert.ok(Math.abs(m.cacheHitPercent - expected) < 1e-10);
  });

  test("sequence and activeBranchSequence are both 1", () => {
    assert.equal(metrics.allMessages[0]?.sequence, 1);
    assert.equal(metrics.allMessages[0]?.activeBranchSequence, 1);
  });

  test("treeTotals accumulates the message; branch totals match", () => {
    assert.equal(metrics.treeTotals.input, usage.input);
    assert.equal(metrics.treeTotals.assistantMessages, 1);
    assert.equal(metrics.activeBranchTotals.input, metrics.treeTotals.input);
  });
});

describe("collectCacheSessionMetrics — two messages, one on branch one off", () => {
  const usageA: FakeUsage = {
    input: 100,
    output: 50,
    cacheRead: 200,
    cacheWrite: 10,
    totalTokens: 360,
  };
  const usageB: FakeUsage = {
    input: 200,
    output: 80,
    cacheRead: 50,
    cacheWrite: 5,
    totalTokens: 335,
  };
  const metrics = collectCacheSessionMetrics(
    makeSessionManager(
      [makeAssistantEntry("e1", usageA), makeAssistantEntry("e2", usageB)],
      ["e1"],
    ),
  );

  test("allMessages has two entries, activeBranchMessages one", () => {
    assert.equal(metrics.allMessages.length, 2);
    assert.equal(metrics.activeBranchMessages.length, 1);
  });

  test("sequence numbers are 1 and 2 in tree order", () => {
    assert.equal(metrics.allMessages[0]?.sequence, 1);
    assert.equal(metrics.allMessages[1]?.sequence, 2);
  });

  test("off-branch message has activeBranchSequence undefined and isOnActiveBranch false", () => {
    const offBranch = metrics.allMessages.find((m) => m.entryId === "e2");
    assert.equal(offBranch?.activeBranchSequence, undefined);
    assert.equal(offBranch?.isOnActiveBranch, false);
  });

  test("treeTotals accumulates both; activeBranchTotals only the branch message", () => {
    assert.equal(metrics.treeTotals.input, usageA.input + usageB.input);
    assert.equal(metrics.treeTotals.assistantMessages, 2);
    assert.equal(metrics.activeBranchTotals.input, usageA.input);
    assert.equal(metrics.activeBranchTotals.assistantMessages, 1);
  });
});

describe("collectCacheSessionMetrics — non-assistant entries are filtered out", () => {
  const usage: FakeUsage = { input: 50, output: 25, cacheRead: 10, cacheWrite: 5, totalTokens: 90 };
  const entries: SessionEntryLike[] = [
    { type: "message", id: "u1", timestamp: "2024-01-01T00:00:00.000Z", message: { role: "user" } },
    makeAssistantEntry("e1", usage),
    { type: "tool_result", id: "t1", timestamp: "2024-01-01T00:00:00.000Z" },
  ];
  const metrics = collectCacheSessionMetrics(makeSessionManager(entries, ["e1"]));

  test("only counts the assistant message", () => {
    assert.equal(metrics.allMessages.length, 1);
    assert.equal(metrics.allMessages[0]?.entryId, "e1");
    assert.equal(metrics.treeTotals.assistantMessages, 1);
  });
});
