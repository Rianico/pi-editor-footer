/**
 * Status slot planner (ADR-0004 rev 2).
 *
 * `⠋ Working` while a run is live, `● Ready` once it settles — same slot on the
 * usage row, so the status never vanishes and never moves. A non-working
 * indicator (retry/compaction) keeps that place in the layout but renders as its
 * own row, so the slot must stay empty rather than claim Ready mid-retry. A fresh
 * session with no tokens/activity grows no row just to announce idleness.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planStatusSlot } from "../src/status-slot.js";

describe("status slot planner", () => {
  test("the working indicator owns the slot, with or without a usage row", () => {
    assert.equal(
      planStatusSlot({ hasIndicator: true, indicatorIsWorking: true, hasUsageRow: true }),
      "working",
    );
    assert.equal(
      planStatusSlot({ hasIndicator: true, indicatorIsWorking: true, hasUsageRow: false }),
      "working",
    );
  });

  test("a non-working indicator leaves the slot empty — retry has its own row", () => {
    assert.equal(
      planStatusSlot({ hasIndicator: true, indicatorIsWorking: false, hasUsageRow: true }),
      "none",
      "retrying must not read as Ready",
    );
  });

  test("idle shows Ready only where the usage row already exists", () => {
    assert.equal(
      planStatusSlot({ hasIndicator: false, indicatorIsWorking: false, hasUsageRow: true }),
      "ready",
    );
    assert.equal(
      planStatusSlot({ hasIndicator: false, indicatorIsWorking: false, hasUsageRow: false }),
      "none",
      "a fresh session does not grow a line to say it is idle",
    );
  });
});
