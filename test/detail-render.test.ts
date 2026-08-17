import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { renderDetail, scroll, type DetailItem } from "../src/detail-render";

const item: DetailItem = {
  label: "to-spec",
  kind: "skill",
  description: "Turn the current conversation into a spec.",
};

describe("renderDetail", () => {
  test("returns [] for a null item", () => {
    assert.deepEqual(renderDetail(null, 40, 5, 0), []);
  });

  test("returns [] for an empty description", () => {
    assert.deepEqual(
      renderDetail({ ...item, description: "" }, 40, 5, 0),
      [],
    );
  });

  test("returns [] for a whitespace-only description", () => {
    assert.deepEqual(
      renderDetail({ ...item, description: "   \n\t " }, 40, 5, 0),
      [],
    );
  });

  test("wraps a long description to width, every line <= width", () => {
    const longItem: DetailItem = {
      ...item,
      description:
        "This is a deliberately long description that will not fit in the window width and must therefore be wrapped across several lines.",
    };
    const lines = renderDetail(longItem, 20, 5, 0);
    assert.ok(lines.length > 1);
    for (const line of lines) {
      assert.ok(line.length <= 20, `line too long: ${JSON.stringify(line)}`);
    }
    // 129 chars at width 20 → 7 content lines → overflows → marker present.
    assert.equal(lines[0], "to-spec · skill 1/7");
  });

  test("shrink-to-fit: short description yields 1 header + content lines", () => {
    // Description is 42 chars — use a width wide enough that it stays on one line.
    const lines = renderDetail(item, 60, 5, 0);
    assert.deepEqual(lines, [
      "to-spec · skill",
      "Turn the current conversation into a spec.",
    ]);
    assert.ok(lines.length < 5);
  });
  test("cap: overflowing description yields exactly maxLines lines", () => {
    const longItem: DetailItem = {
      ...item,
      description: "word ".repeat(60).trim(),
    };
    const lines = renderDetail(longItem, 20, 5, 0);
    assert.equal(lines.length, 5);
  });

  test("header carries a scroll marker only when overflowing", () => {
    // Fits: no marker.
    const fits = renderDetail(item, 40, 5, 0);
    assert.equal(fits[0], "to-spec · skill");

    // Overflows: marker ` offset/total` appended.
    const longItem: DetailItem = {
      ...item,
      description: "word ".repeat(60).trim(),
    };
    const overflows = renderDetail(longItem, 20, 5, 0);
    assert.match(overflows[0], /^to-spec · skill \d+\/\d+$/);
    assert.equal(overflows[0], "to-spec · skill 1/15");
  });

  test("scrollOffset shifts which content lines are visible", () => {
    // 160 chars at width 30 → 6 content lines with distinct wrap phases;
    // window shows header + 4 → overflows, max scroll offset 2.
    const overflowing: DetailItem = {
      ...item,
      description: "abcdefghij klmnopqrst uvwxyzabcd".repeat(5),
    };
    const top = renderDetail(overflowing, 30, 5, 0);
    assert.equal(top[0], "to-spec · skill 1/6");

    const scrolled = renderDetail(overflowing, 30, 5, 1);
    assert.equal(scrolled.length, 5);
    assert.equal(scrolled[0], "to-spec · skill 2/6");
    // Scrolled lines must differ from the top lines.
    assert.notDeepEqual(scrolled.slice(1), top.slice(1));
  });

  test("clamps scrollOffset above the maximum", () => {
    const longItem: DetailItem = {
      ...item,
      description: "x".repeat(200),
    };
    // 200 chars at width 20 → 10 content lines; window shows 4 content lines → max offset 6.
    const lines = renderDetail(longItem, 20, 5, 999);
    assert.equal(lines.length, 5);
    assert.equal(lines[0], "to-spec · skill 7/10");
  });

  test("clamps negative scrollOffset to 0", () => {
    const longItem: DetailItem = {
      ...item,
      description: "x".repeat(200),
    };
    const lines = renderDetail(longItem, 20, 5, -5);
    assert.equal(lines.length, 5);
    assert.equal(lines[0], "to-spec · skill 1/10");
  });

  test("preserves explicit paragraph breaks in the description", () => {
    const multiline: DetailItem = {
      ...item,
      description: "First paragraph.\n\nSecond paragraph.",
    };
    const lines = renderDetail(multiline, 40, 5, 0);
    assert.deepEqual(lines, [
      "to-spec · skill",
      "First paragraph.",
      "",
      "Second paragraph.",
    ]);
  });

  test("header never exceeds width and the scroll marker survives truncation", () => {
    const overflowing: DetailItem = {
      ...item,
      description: "x".repeat(200),
    };
    const lines = renderDetail(overflowing, 10, 5, 0);
    assert.ok(lines[0].length <= 10);
    assert.match(lines[0], /\d+\/\d+$/);
  });

  test("shows '...' on the last visible line when content remains below", () => {
    const longItem: DetailItem = {
      ...item,
      description: "x".repeat(200), // 10 content lines at width 20
    };
    const lines = renderDetail(longItem, 20, 5, 0);
    assert.equal(lines[4], "...");
  });

  test("no bottom ellipsis when scrolled to the bottom", () => {
    const longItem: DetailItem = {
      ...item,
      description: "x".repeat(200),
    };
    const lines = renderDetail(longItem, 20, 5, 999); // clamped to max offset 6
    assert.equal(lines.length, 5);
    assert.notEqual(lines[4], "...");
  });

  test("top ellipsis when scrolled down hides content above", () => {
    const longItem: DetailItem = {
      ...item,
      description: "x".repeat(200),
    };
    const mid = renderDetail(longItem, 20, 5, 3);
    assert.equal(mid[1], "..."); // first visible content line
    assert.equal(mid[4], "..."); // still more below
  });

  test("no ellipsis when the description fits the window", () => {
    const lines = renderDetail(item, 60, 5, 0);
    assert.deepEqual(lines, [
      "to-spec · skill",
      "Turn the current conversation into a spec.",
    ]);
    assert.ok(!lines.includes("..."));
  });
});

describe("scroll", () => {
  test("returns 0 when the description fits the window", () => {
    assert.equal(scroll(0, 1, 2, 5), 0);
    assert.equal(scroll(3, -1, 2, 5), 0);
  });

  test("advances one line per delta within bounds", () => {
    // 10 content lines, window shows 4 → max offset 6.
    assert.equal(scroll(0, 1, 10, 5), 1);
    assert.equal(scroll(3, 1, 10, 5), 4);
    assert.equal(scroll(4, -1, 10, 5), 3);
  });

  test("clamps at the bottom (forward)", () => {
    assert.equal(scroll(6, 1, 10, 5), 6);
    assert.equal(scroll(999, 1, 10, 5), 6);
  });

  test("clamps at the top (back)", () => {
    assert.equal(scroll(0, -1, 10, 5), 0);
  });

  test("edge: window of 1 line means no content scrollable", () => {
    assert.equal(scroll(0, 1, 10, 1), 0);
  });
});
