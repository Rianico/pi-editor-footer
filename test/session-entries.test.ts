import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isAssistantUsageEntry,
  isSummaryEntry,
  isToolResultEntry,
  usageNumbers,
  type SessionEntryLike,
} from "../src/session-entries.js";

const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 };

function messageEntry(role: string, withUsage: boolean): SessionEntryLike {
  return {
    type: "message",
    id: "e1",
    timestamp: "t1",
    message: withUsage ? { role, usage } : { role },
  };
}

describe("isAssistantUsageEntry", () => {
  test("assistant message with usage is true", () => {
    assert.equal(isAssistantUsageEntry(messageEntry("assistant", true)), true);
  });

  test("assistant message WITHOUT usage is false", () => {
    assert.equal(isAssistantUsageEntry(messageEntry("assistant", false)), false);
  });

  test("toolResult message is false", () => {
    assert.equal(isAssistantUsageEntry(messageEntry("toolResult", true)), false);
  });

  test("user message is false", () => {
    assert.equal(isAssistantUsageEntry(messageEntry("user", false)), false);
  });

  test("message entry with no message at all is false", () => {
    assert.equal(isAssistantUsageEntry({ type: "message" }), false);
  });

  test("non-message entry (compaction with top-level usage) is false", () => {
    assert.equal(isAssistantUsageEntry({ type: "compaction", usage }), false);
  });
});

describe("isToolResultEntry", () => {
  test("toolResult message is true with and without usage", () => {
    assert.equal(isToolResultEntry(messageEntry("toolResult", true)), true);
    assert.equal(isToolResultEntry(messageEntry("toolResult", false)), true);
  });

  test("assistant message is false", () => {
    assert.equal(isToolResultEntry(messageEntry("assistant", true)), false);
  });

  test("top-level type tool_result (not a message entry) is false", () => {
    assert.equal(isToolResultEntry({ type: "tool_result" }), false);
  });

  test("message entry with no message at all is false", () => {
    assert.equal(isToolResultEntry({ type: "message" }), false);
  });
});

describe("isSummaryEntry", () => {
  test("branch_summary and compaction are true", () => {
    assert.equal(isSummaryEntry({ type: "branch_summary" }), true);
    assert.equal(isSummaryEntry({ type: "compaction" }), true);
  });

  test("message entries are false regardless of role", () => {
    assert.equal(isSummaryEntry(messageEntry("assistant", true)), false);
    assert.equal(isSummaryEntry(messageEntry("toolResult", true)), false);
  });

  test("other entry types are false", () => {
    assert.equal(isSummaryEntry({ type: "tool_result" }), false);
    assert.equal(isSummaryEntry({ type: "model_change" }), false);
  });
});

describe("usageNumbers", () => {
  test("missing numeric fields default to 0", () => {
    assert.deepEqual(usageNumbers({}), {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    });
  });

  test("present fields pass through unchanged", () => {
    assert.deepEqual(usageNumbers(usage), {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
    });
  });

  test("partial usage fills only the missing fields with 0", () => {
    assert.deepEqual(usageNumbers({ input: 5, cacheWrite: 7 }), {
      input: 5,
      output: 0,
      cacheRead: 0,
      cacheWrite: 7,
      totalTokens: 0,
    });
  });

  test("cost is not part of the normalized numbers", () => {
    const n = usageNumbers({ input: 1, cost: { total: 0.25 } }) as Record<string, unknown>;
    assert.equal("cost" in n, false);
  });
});
