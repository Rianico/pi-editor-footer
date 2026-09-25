import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildCsv, csvEscape, sanitizeFileName } from "../src/cache-export.js";
import type { CacheSessionMetrics } from "../src/cache-types.js";

function makeMinimalMetrics(): CacheSessionMetrics {
  return {
    allMessages: [
      {
        sequence: 1,
        activeBranchSequence: 1,
        entryId: "e1",
        timestamp: "2024-06-01T12:00:00.000Z",
        provider: "anthropic",
        model: "claude-3",
        input: 100,
        output: 50,
        cacheRead: 200,
        cacheWrite: 10,
        totalTokens: 360,
        cacheHitPercent: 64.52,
        isOnActiveBranch: true,
      },
    ],
    activeBranchMessages: [],
    treeTotals: {
      input: 100,
      output: 50,
      cacheRead: 200,
      cacheWrite: 10,
      totalTokens: 360,
      assistantMessages: 1,
    },
    activeBranchTotals: {
      input: 100,
      output: 50,
      cacheRead: 200,
      cacheWrite: 10,
      totalTokens: 360,
      assistantMessages: 1,
    },
  };
}

describe("csvEscape", () => {
  test("returns plain strings unchanged", () => {
    assert.equal(csvEscape("hello"), "hello");
    assert.equal(csvEscape("abc123"), "abc123");
  });

  test("wraps strings containing a comma, quote, or newline in double-quotes", () => {
    assert.equal(csvEscape("a,b"), '"a,b"');
    assert.equal(csvEscape('say "hello"'), '"say ""hello"""');
    assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
  });

  test("returns empty string for null and undefined", () => {
    assert.equal(csvEscape(null), "");
    assert.equal(csvEscape(undefined), "");
  });

  test("converts numbers and booleans to strings without quotes", () => {
    assert.equal(csvEscape(42), "42");
    assert.equal(csvEscape(3.14), "3.14");
    assert.equal(csvEscape(true), "true");
    assert.equal(csvEscape(false), "false");
  });
});

describe("sanitizeFileName", () => {
  test("returns alphanumeric names unchanged", () => {
    assert.equal(sanitizeFileName("mysession"), "mysession");
    assert.equal(sanitizeFileName("session123"), "session123");
  });

  test("allows dots and dashes", () => {
    assert.equal(sanitizeFileName("my-session.v2"), "my-session.v2");
  });

  test("replaces spaces with dashes", () => {
    assert.equal(sanitizeFileName("my session"), "my-session");
  });

  test("collapses multiple consecutive special characters into one dash", () => {
    assert.equal(sanitizeFileName("foo  bar"), "foo-bar");
    assert.equal(sanitizeFileName("foo!!bar"), "foo-bar");
  });

  test("strips leading and trailing dashes and dots", () => {
    assert.equal(sanitizeFileName("-hello-"), "hello");
    assert.equal(sanitizeFileName(".hello."), "hello");
  });

  test("returns the fallback 'session' for a name that sanitizes to empty", () => {
    assert.equal(sanitizeFileName(""), "session");
    assert.equal(sanitizeFileName("!!!"), "session");
  });
});

describe("buildCsv", () => {
  test("first line is the comma-separated header row", () => {
    const firstLine = buildCsv(makeMinimalMetrics()).split("\n")[0]!;
    assert.ok(firstLine.includes("row_type"));
    assert.ok(firstLine.includes("cache_hit_percent"));
    assert.ok(firstLine.includes("delta_sent_tokens"));
  });

  test("contains three summary rows", () => {
    const csv = buildCsv(makeMinimalMetrics());
    const summaryLines = csv.split("\n").filter((line) => line.startsWith("summary,"));
    assert.equal(summaryLines.length, 3);
  });

  test("contains a message row when allMessages is non-empty, and none when empty", () => {
    const csv = buildCsv(makeMinimalMetrics());
    assert.equal(csv.split("\n").filter((line) => line.startsWith("message,")).length, 1);
    assert.ok(csv.includes("e1"));

    const emptyCsv = buildCsv({ ...makeMinimalMetrics(), allMessages: [] });
    assert.equal(emptyCsv.split("\n").filter((line) => line.startsWith("message,")).length, 0);
  });

  test("each data row has the same number of columns as the header", () => {
    const csv = buildCsv(makeMinimalMetrics());
    const lines = csv.split("\n").filter((l) => l.trim() !== "");
    const headerCount = lines[0]!.split(",").length;
    for (const line of lines.slice(1)) {
      // Our fixture has no embedded commas, so a naive split is exact.
      assert.equal(line.split(",").length, headerCount);
    }
  });

  test("ends with a trailing newline", () => {
    assert.ok(buildCsv(makeMinimalMetrics()).endsWith("\n"));
  });
});
