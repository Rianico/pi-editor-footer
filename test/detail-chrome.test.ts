import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DetailChrome, MAX_LINES } from "../src/detail-chrome.js";
import type { SelectItem } from "@earendil-works/pi-tui";

// Theme stub — DetailChrome reads theme at render time
const fakeTheme = {
  fg(_c: string, s: string): string {
    return s;
  },
  bold(s: string): string {
    return s;
  },
};

const skillItem: SelectItem = {
  label: "to-spec",
  value: "skill:to-spec",
  description: "Turn the current conversation into a spec.",
} as SelectItem;

const commandItem: SelectItem = {
  label: "/review",
  value: "/review",
  description: "Review the codebase.",
} as SelectItem;

function longItem(chars = 200): SelectItem {
  return {
    label: "to-spec",
    value: "skill:to-spec",
    description: "x".repeat(chars),
  } as SelectItem;
}

describe("DetailChrome", () => {
  test("default maxLines is 5", () => {
    const c = new DetailChrome();
    assert.equal(c.maxLines, 5);
    assert.equal(MAX_LINES, 5);
  });

  test("hasContent is false when no item", () => {
    const c = new DetailChrome();
    assert.equal(c.hasContent(), false);
    assert.deepEqual(c.render(80, fakeTheme), []);
    assert.equal(c.getItem(), null);
  });

  test("hasContent is false for empty/whitespace description", () => {
    const c = new DetailChrome();
    c.setItem({ ...skillItem, description: "   \n\t " } as SelectItem);
    assert.equal(c.hasContent(), false);
    assert.deepEqual(c.render(80, fakeTheme), []);
  });

  test("setItem stores item and restarts scroll", () => {
    const c = new DetailChrome();
    c.setItem(longItem(200));
    c.render(20, fakeTheme);
    c.scrollBy(1);
    assert.equal(c.getScrollOffset(), 1);
    c.setItem(skillItem);
    assert.equal(c.getScrollOffset(), 0);
    assert.equal(c.getItem(), skillItem);
  });

  test("setItem(null) hides the window", () => {
    const c = new DetailChrome();
    c.setItem(skillItem);
    assert.equal(c.hasContent(), true);
    c.setItem(null);
    assert.equal(c.hasContent(), false);
    assert.deepEqual(c.render(80, fakeTheme), []);
  });

  test("render returns a bordered box for a valid item", () => {
    const c = new DetailChrome();
    c.setItem(skillItem);
    const out = c.render(40, fakeTheme);
    assert.ok(out.length >= 3);
    assert.match(out[0]!, /^┌.*┐$/);
    assert.match(out.at(-1)!, /^└.*┘$/);
    assert.match(out[1]!, /to-spec · skill/);
  });

  test("render returns [] when hidden regardless of width/theme", () => {
    const c = new DetailChrome();
    c.setItem(null);
    assert.deepEqual(c.render(20, fakeTheme), []);
    c.setItem({ ...skillItem, description: "" } as SelectItem);
    assert.deepEqual(c.render(20, fakeTheme), []);
  });

  test("scrollBy advances one line and clamps", () => {
    const c = new DetailChrome();
    c.setItem(longItem(200));
    // width 20 → inner 16 → "x".repeat(200) wraps to 13 lines, capacity 4 → max 9
    c.render(20, fakeTheme);
    assert.equal(c.scrollBy(1), 1);
    assert.equal(c.scrollBy(1), 2);
    assert.equal(c.scrollBy(-1), 1);
    assert.equal(c.scrollBy(-1), 0);
    assert.equal(c.scrollBy(-1), 0);
    for (let i = 0; i < 10; i++) c.scrollBy(1);
    assert.equal(c.getScrollOffset(), 9);
  });

  test("scrollBy is no-op when window is hidden", () => {
    const c = new DetailChrome();
    c.setItem(null);
    c.render(40, fakeTheme);
    assert.equal(c.scrollBy(1), 0);
    assert.equal(c.getScrollOffset(), 0);
  });

  test("scrollBy is no-op when content fits", () => {
    const c = new DetailChrome();
    c.setItem(skillItem);
    c.render(60, fakeTheme);
    assert.equal(c.scrollBy(1), 0);
  });

  test("render respects scroll offset and shows marker", () => {
    const c = new DetailChrome();
    c.setItem({
      label: "to-spec",
      value: "skill:to-spec",
      description: "abcdefghij klmnopqrst uvwxyzabcd".repeat(5),
    } as SelectItem);
    const top = c.render(20, fakeTheme);
    assert.match(top[1]!, /\d+\/\d+/);
    c.scrollBy(1);
    const scrolled = c.render(20, fakeTheme);
    assert.match(scrolled[1]!, /\d+\/\d+/);
    assert.notDeepEqual(top.slice(2), scrolled.slice(2));
  });

  test("kindOf maps skill: prefix to skill, otherwise command", () => {
    const c = new DetailChrome();
    c.setItem(skillItem);
    const skillOut = c.render(40, fakeTheme);
    assert.match(skillOut[1]!, /· skill/);
    c.setItem(commandItem);
    const cmdOut = c.render(40, fakeTheme);
    assert.match(cmdOut[1]!, /· command/);
  });

  test("custom maxLines is clamped to >=1", () => {
    const c = new DetailChrome(1);
    assert.equal(c.maxLines, 1);
    const zero = new DetailChrome(0);
    assert.equal(zero.maxLines, 1);
  });

  test("lastWidth affects scrollBy clamping (innerWidth = width-4)", () => {
    const c = new DetailChrome();
    c.setItem(longItem(200));
    c.render(20, fakeTheme);
    c.render(60, fakeTheme);
    let off = c.getScrollOffset();
    for (let i = 0; i < 20; i++) off = c.scrollBy(1);
    assert.ok(off >= 0 && off <= 9);
  });
});
