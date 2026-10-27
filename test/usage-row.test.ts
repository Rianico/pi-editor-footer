/**
 * Usage row composition (ADR-0004 revision 3, #63).
 *
 * The row above the editor frame is three fields, not a concatenation:
 * `status | delta tokens · activity | stall`. `|` separates fields, `·`
 * separates the sections of one field, and a field that is absent emits no
 * separator at all — an empty status slot must not leave a leading pipe.
 * Delta tokens lead the run field, so the pair (the stable half) never moves
 * when the activity half grows (`3 tools` → `12 tools (2 running)`), and a
 * stall is its own field because a stall is a condition, not an activity.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { composeUsageRow } from "../src/usage-row.js";

/** Identity theme: the rule is asserted as characters, styling as structure. */
const theme = { fg: (_style: string, text: string) => text };

const STATUS = "⠋ Working";
const TOKENS = "↑ 40k · ↓ 8k";
const ACTIVITY = "2 turns · 8s · 3 tools";
const STALL = "!2×3.3s";

describe("composeUsageRow — `status | delta tokens · activity | stall`", () => {
  test("the three fields are `|`-separated, the run field's sections `·`-separated", () => {
    assert.equal(
      composeUsageRow({ status: STATUS, tokens: TOKENS, activity: ACTIVITY, stall: STALL }, theme),
      `${STATUS} | ${TOKENS} · ${ACTIVITY} | ${STALL}`,
    );
  });

  test("delta tokens come first inside the run field", () => {
    const row = composeUsageRow({ tokens: TOKENS, activity: ACTIVITY }, theme);
    assert.equal(row, `${TOKENS} · ${ACTIVITY}`);
    assert.ok(row.indexOf(TOKENS) < row.indexOf(ACTIVITY), row);
  });

  test("an empty status slot leaves no leading or doubled pipe", () => {
    // Retry/compaction: pi's indicator owns the slot but must not claim it.
    assert.equal(
      composeUsageRow({ status: "", tokens: TOKENS, activity: ACTIVITY }, theme),
      `${TOKENS} · ${ACTIVITY}`,
    );
    assert.equal(
      composeUsageRow({ tokens: TOKENS, activity: ACTIVITY, stall: STALL }, theme),
      `${TOKENS} · ${ACTIVITY} | ${STALL}`,
    );
  });

  test("a stall is its own field, absent when the run is healthy", () => {
    const healthy = composeUsageRow({ status: STATUS, tokens: TOKENS, activity: ACTIVITY }, theme);
    assert.equal(healthy, `${STATUS} | ${TOKENS} · ${ACTIVITY}`);
    assert.ok(!healthy.includes("|", healthy.indexOf(STATUS) + STATUS.length + 3), healthy);
    const stalled = composeUsageRow(
      { status: STATUS, tokens: TOKENS, activity: ACTIVITY, stall: STALL },
      theme,
    );
    assert.ok(stalled.endsWith(` | ${STALL}`), stalled);
    assert.ok(!stalled.includes(`· ${STALL}`), "a condition, not another activity section");
  });

  test("a stall alone is the whole row: no leading `|`, no leading `·`", () => {
    // #63 invariant 4, existence half: a row can consist of the stall and nothing
    // else. Any leading separator here would be a field boundary to a missing field.
    assert.equal(composeUsageRow({ stall: STALL }, theme), STALL);
  });

  test("the delta pair is the stable half: a wider activity never shifts it", () => {
    const narrow = composeUsageRow({ status: STATUS, tokens: TOKENS, activity: "3 tools" }, theme);
    const wide = composeUsageRow(
      { status: STATUS, tokens: TOKENS, activity: "12 tools (2 running)" },
      theme,
    );
    const [prefixNarrow] = narrow.split("3 tools");
    const [prefixWide] = wide.split("12 tools");
    assert.equal(prefixNarrow, prefixWide, "same columns, whatever the activity costs");
    assert.equal(prefixNarrow, `${STATUS} | ${TOKENS} · `);
  });

  test("the run field without a status slot carries no field boundary", () => {
    assert.equal(composeUsageRow({ activity: ACTIVITY }, theme), ACTIVITY);
    assert.equal(
      composeUsageRow({ status: STATUS, activity: ACTIVITY }, theme),
      `${STATUS} | ${ACTIVITY}`,
    );
  });

  test("nothing present: no row at all", () => {
    assert.equal(composeUsageRow({}, theme), "");
  });
});
