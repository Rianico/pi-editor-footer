import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getUsageTotals, invalidateUsageCache, totalInputTokens } from "../src/state.js";

interface EntryUsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

function usage(over: EntryUsageLike = {}): EntryUsageLike {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 }, ...over };
}

/** Opaque pi seam — getUsageTotals only reads sessionManager.getEntries(). */
function ctxWith(entries: unknown[]): never {
  return { sessionManager: { getEntries: () => entries } } as never;
}

describe("getUsageTotals", () => {
  test("counts assistant, toolResult and summary usage toward session totals", () => {
    invalidateUsageCache();
    const totals = getUsageTotals(
      ctxWith([
        {
          type: "message",
          id: "m1",
          message: {
            role: "assistant",
            usage: usage({
              input: 395,
              output: 505,
              cacheRead: 340_000,
              cacheWrite: 12_000,
              cost: { total: 0.16 },
            }),
          },
        },
        { type: "message", id: "m2", message: { role: "user" } },
        {
          type: "message",
          id: "m3",
          message: {
            role: "toolResult",
            usage: usage({ input: 100, output: 20, cost: { total: 0.01 } }),
          },
        },
        {
          type: "compaction",
          id: "m4",
          usage: usage({ input: 50, output: 10, cacheRead: 30, cost: { total: 0.005 } }),
        },
        { type: "branch_summary", id: "m5", usage: usage({ output: 7 }) },
      ]),
    );

    assert.equal(totals.input, 545);
    assert.equal(totals.output, 542);
    assert.equal(totals.cacheRead, 340_030);
    assert.equal(totals.cacheWrite, 12_000);
    assert.ok(Math.abs(totals.cost - 0.175) < 1e-9, String(totals.cost));
    // Hit rate comes from the assistant turn only, not the nested-call usage.
    assert.equal(totals.latestCacheHitRate, (340_000 / (395 + 340_000 + 12_000)) * 100);
  });

  test("totalInputTokens folds cached prompt tokens into input", () => {
    const totals = getUsageTotals(
      ctxWith([
        {
          type: "message",
          id: "n1",
          message: {
            role: "assistant",
            usage: usage({ input: 1_000, cacheRead: 8_000, cacheWrite: 2_000 }),
          },
        },
      ]),
    );
    assert.equal(totalInputTokens(totals), 11_000);
    assert.equal(totalInputTokens({ input: 0, cacheRead: 0, cacheWrite: 0 }), 0);
  });

  test("assistant turn with zero prompt keeps latestCacheHitRate undefined (edge semantics)", () => {
    invalidateUsageCache();
    const totals = getUsageTotals(
      ctxWith([
        {
          type: "message",
          id: "z1",
          message: { role: "assistant", usage: usage({ input: 0, output: 5 }) },
        },
      ]),
    );
    // Current behavior: hit rate is only set when the prompt total > 0, so
    // "no cache seen yet" (undefined) stays distinct from "0% hit".
    assert.equal(totals.latestCacheHitRate, undefined);

    invalidateUsageCache();
    // A later zero-prompt turn must not clobber the previous real rate.
    const later = getUsageTotals(
      ctxWith([
        {
          type: "message",
          id: "z2",
          message: { role: "assistant", usage: usage({ input: 100, cacheRead: 100 }) },
        },
        {
          type: "message",
          id: "z3",
          message: { role: "assistant", usage: usage({ input: 0, output: 0 }) },
        },
      ]),
    );
    assert.equal(later.latestCacheHitRate, 50);
  });

  test("caches by entry set — new entries recompute, identical set is stable", () => {
    invalidateUsageCache();
    const entries = [
      {
        type: "message",
        id: "p1",
        message: { role: "assistant", usage: usage({ input: 10, output: 1 }) },
      },
    ];
    const first = getUsageTotals(ctxWith(entries));
    assert.equal(first.input, 10);

    entries.push({
      type: "message",
      id: "p2",
      message: { role: "assistant", usage: usage({ input: 5, output: 2 }) },
    });
    const second = getUsageTotals(ctxWith(entries));
    assert.equal(second.input, 15);
    assert.equal(second.output, 3);

    // Same entry set → same totals object out of the cache.
    assert.equal(getUsageTotals(ctxWith(entries)), second);
  });
});
