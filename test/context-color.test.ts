import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hexFg, hexToRgb, normalizeColorMode, rgbTo256, rgbToFgAnsi } from "../src/ansi-color.js";
import { adaptTheme, ChromeComposition } from "../src/chrome-composition.js";
import { createChromeSnapshot, formatContextBar } from "../src/chrome-state.js";

const TRUE_COLOR = "\x1b[38;2;163;190;140m"; // #A3BE8C
const DARK_RED = "\x1b[38;2;154;57;57m"; // #9A3939
const RESET_FG = "\x1b[39m";

function snapshotWith(percent: number, contextWindow: number) {
  return createChromeSnapshot(
    {
      sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
      getContextUsage: () => ({ percent, tokens: 1000, contextWindow }),
    } as unknown as never,
    null,
  );
}

describe("ansi-color", () => {
  test("hexToRgb parses with and without the leading hash", () => {
    assert.deepEqual(hexToRgb("#A3BE8C"), { r: 163, g: 190, b: 140 });
    assert.deepEqual(hexToRgb("9A3939"), { r: 154, g: 57, b: 57 });
  });

  test("hexToRgb rejects malformed input", () => {
    assert.throws(() => hexToRgb("#12345"), /Invalid hex color/);
    assert.throws(() => hexToRgb("#zzzzzz"), /Invalid hex color/);
  });

  test("normalizeColorMode defaults to the 256 ramp", () => {
    assert.equal(normalizeColorMode("truecolor"), "truecolor");
    assert.equal(normalizeColorMode("256color"), "256color");
    assert.equal(normalizeColorMode(undefined), "256color");
  });

  test("rgbToFgAnsi emits truecolor or a 256 index", () => {
    assert.equal(rgbToFgAnsi({ r: 163, g: 190, b: 140 }, "truecolor"), TRUE_COLOR);
    const quantized = rgbToFgAnsi({ r: 163, g: 190, b: 140 }, undefined);
    assert.equal(quantized, `\x1b[38;5;${rgbTo256(163, 190, 140)}m`);
  });

  test("hexFg wraps text and resets only the foreground", () => {
    assert.equal(hexFg("#A3BE8C", "truecolor")("hi"), `${TRUE_COLOR}hi${RESET_FG}`);
  });
});

describe("adaptTheme fgHex", () => {
  test("renders exact hex at the theme's color mode", () => {
    const t = adaptTheme({
      fg: (s: string, v: string) => `[${s}]${v}[/]`,
      getColorMode: () => "truecolor",
    });
    assert.equal(t.fgHex("#9A3939", "x"), `${DARK_RED}x${RESET_FG}`);
  });

  test("falls back to 256 when the theme reports no color mode", () => {
    const t = adaptTheme({});
    assert.equal(t.fgHex("#9A3939", "x"), `\x1b[38;5;${rgbTo256(154, 57, 57)}mx${RESET_FG}`);
  });
});

describe("context window section color", () => {
  test("1M window at 5% is green, at 20% amber, at 30% dark red", () => {
    const c = new ChromeComposition("ascii", {
      fg: (_s: string, v: string) => v,
      getColorMode: () => "truecolor",
    });
    assert.ok(c.formatTopContext(snapshotWith(5, 1_000_000), false).includes(TRUE_COLOR));
    assert.ok(
      c.formatTopContext(snapshotWith(20, 1_000_000), false).includes("\x1b[38;2;235;203;139m"),
    );
    assert.ok(c.formatTopContext(snapshotWith(30, 1_000_000), false).includes(DARK_RED));
  });

  test("small window keeps green up to 25% and turns dark red at 50%", () => {
    const c = new ChromeComposition("ascii", {
      fg: (_s: string, v: string) => v,
      getColorMode: () => "truecolor",
    });
    assert.ok(c.formatTopContext(snapshotWith(24, 200_000), false).includes(TRUE_COLOR));
    assert.ok(c.formatTopContext(snapshotWith(50, 200_000), false).includes(DARK_RED));
  });

  test("icon bar mode colors the bar fill with the same tier", () => {
    const c = new ChromeComposition("ascii", {
      fg: (_s: string, v: string) => v,
      getColorMode: () => "truecolor",
    });
    const out = c.formatTopContext(snapshotWith(30, 1_000_000), true);
    assert.ok(out.includes(DARK_RED));
  });

  test("theme without fgHex falls back to the semantic token", () => {
    // Direct formatContextBar caller: the chrome adapter always supplies fgHex,
    // so the semantic fallback covers non-adapter consumers (tests, extensions).
    const theme = { fg: (style: string, v: string) => `[${style}]${v}[/]` };
    const out = formatContextBar(
      { percent: 30, tokens: 1000, contextWindow: 1_000_000 },
      theme,
      { context: "#", cacheHit: "c" } as never,
      true,
    );
    assert.ok(out.includes("[error]30.0%[/]"));
    assert.ok(!out.includes("\x1b[38"));
  });
});
