/**
 * Cursor preview marker across pi-tui renderer shapes (issue #40).
 *
 * pi-tui 1.3.0 no longer inlines the software cursor as a reverse-video pair
 * (`\x1b[7m…\x1b[0m`). The editor now wraps the cursor cell in zero-width
 * fake-cursor APC markers and emits `CURSOR_MARKER` only while it is focused,
 * so `CursorPolicy` has to read the new shape to keep the unfocused preview
 * (and to remove the software cursor once focused).
 *
 * These tests drive the real `Editor` so the sequences under test are pi-tui's
 * own, not fixtures copied by hand.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CURSOR_MARKER, Editor, renderFakeCursor, visibleWidth } from "@earendil-works/pi-tui";
import { CursorPolicy, removeSoftwareCursor, type CursorStyle } from "../src/cursor-policy.js";
import { TrackingEditor } from "../src/tracking-editor.js";

const WIDTH = 40;
/** pi-tui 1.3.0 fake-cursor pair — the software cursor the editor renders unfocused. */
const FAKE_CURSOR_START = "\u001b_pi:fc\u0007";
const FAKE_CURSOR_END = "\u001b_pi:/fc\u0007";

const tui = {
  requestRender: () => {},
  setShowHardwareCursor: () => {},
  terminal: { rows: 24, columns: 80, write: () => {} },
};

const editorTheme = { borderColor: (s: string) => s, selectList: {} };

/** Theme live-border/marker rendering reads at draw time. */
const liveTheme = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (s: string) => s,
  fg: (_style: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
  muted: (s: string) => s,
};

function renderEditor(text: string, focused: boolean): string[] {
  const editor = new Editor(tui as never, editorTheme as never);
  editor.setText(text);
  editor.focused = focused;
  return editor.render(WIDTH);
}

function mapLines(style: CursorStyle, lines: string[], isFocused: boolean): string[] {
  const policy = new CursorPolicy(tui as never);
  policy.setStyle(style);
  return policy.mapLines(lines, isFocused);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function totalOccurrences(lines: string[], needle: string): number {
  return lines.reduce((sum, line) => sum + occurrences(line, needle), 0);
}

function columnOf(line: string, needle: string): number {
  const index = line.indexOf(needle);
  assert.notEqual(index, -1, `expected marker in ${JSON.stringify(line)}`);
  return visibleWidth(line.slice(0, index));
}

describe("cursor preview marker on pi-tui 1.3.0", () => {
  for (const style of ["bar", "underline"] as const) {
    test(`${style}: unfocused editor previews exactly one marker at the cursor cell`, () => {
      const raw = renderEditor("hello world", false);

      // Pre-fix symptom (issue #40): the editor emits no CURSOR_MARKER unfocused.
      assert.equal(totalOccurrences(raw, CURSOR_MARKER), 0);
      assert.equal(totalOccurrences(raw, FAKE_CURSOR_START), 1);

      const mapped = mapLines(style, raw, false);

      assert.equal(totalOccurrences(mapped, CURSOR_MARKER), 1);
      // The software cursor must not survive as a reverse-video block.
      assert.equal(totalOccurrences(mapped, FAKE_CURSOR_START), 0);
      assert.equal(totalOccurrences(mapped, FAKE_CURSOR_END), 0);
      assert.equal(totalOccurrences(mapped, "\x1b[7m"), 0);

      const cursorLine = mapped.find((line) => line.includes(CURSOR_MARKER));
      assert.ok(cursorLine);
      assert.equal(columnOf(cursorLine, CURSOR_MARKER), visibleWidth("hello world"));

      // Layout is untouched: the marker is zero-width.
      assert.deepEqual(
        mapped.map((line) => visibleWidth(line)),
        raw.map((line) => visibleWidth(line)),
      );
    });
  }

  test("focused: the editor's own marker survives and is never duplicated", () => {
    const raw = renderEditor("hello world", true);

    assert.equal(totalOccurrences(raw, CURSOR_MARKER), 1);

    const mapped = mapLines("bar", raw, true);

    assert.equal(totalOccurrences(mapped, CURSOR_MARKER), 1);
    assert.equal(totalOccurrences(mapped, FAKE_CURSOR_START), 0);
    assert.equal(totalOccurrences(mapped, "\x1b[7m"), 0);

    const cursorLine = mapped.find((line) => line.includes(CURSOR_MARKER));
    assert.ok(cursorLine);
    assert.equal(columnOf(cursorLine, CURSOR_MARKER), visibleWidth("hello world"));
  });

  test("block style leaves the software cursor untouched", () => {
    const raw = renderEditor("hello world", false);

    const mapped = mapLines("block", raw, false);

    assert.deepEqual(mapped, raw);
    assert.equal(totalOccurrences(mapped, FAKE_CURSOR_START), 1);
    assert.equal(totalOccurrences(mapped, CURSOR_MARKER), 0);
  });

  test("preview marker is injected once across a multi-line render", () => {
    const raw = renderEditor("line one\nline two", false);

    const mapped = mapLines("bar", raw, false);

    assert.equal(totalOccurrences(mapped, CURSOR_MARKER), 1);
    assert.equal(totalOccurrences(mapped, FAKE_CURSOR_START), 0);
  });

  test("wide-char cursor cell keeps its width and marker column", () => {
    const raw = `ab${renderFakeCursor("中")}cd`;

    const mapped = removeSoftwareCursor(raw, CURSOR_MARKER);

    assert.equal(mapped, `ab${CURSOR_MARKER}中cd`);
    assert.equal(visibleWidth(mapped), visibleWidth(raw));
    assert.equal(columnOf(mapped, CURSOR_MARKER), 2);
  });

  test("wide-char editor render keeps line widths after mapping", () => {
    const raw = renderEditor("中文 abc", false);
    const mapped = mapLines("underline", raw, false);

    assert.equal(totalOccurrences(mapped, CURSOR_MARKER), 1);
    assert.deepEqual(
      mapped.map((line) => visibleWidth(line)),
      raw.map((line) => visibleWidth(line)),
    );
  });

  test("legacy reverse-video renderer still injects the marker (version-agnostic fallback)", () => {
    assert.equal(removeSoftwareCursor("\x1b[7mx\x1b[0m", CURSOR_MARKER), `${CURSOR_MARKER}x`);
    assert.equal(
      removeSoftwareCursor("ab\x1b[7mc\x1b[0mde", CURSOR_MARKER),
      `ab${CURSOR_MARKER}cde`,
    );
    // Without a marker the software cursor is simply removed.
    assert.equal(removeSoftwareCursor("ab\x1b[7mc\x1b[0mde"), "abcde");
  });

  test("TrackingEditor keeps the marker through the live border pipeline", () => {
    const editor = new TrackingEditor(
      tui as never,
      editorTheme as never,
      { matches: () => false },
      () => liveTheme,
    );
    editor.setChrome({ cursorStyle: "bar" });
    editor.setText("hello world");
    editor.focused = false;

    const out = editor.render(WIDTH);

    assert.equal(totalOccurrences(out, CURSOR_MARKER), 1);
    assert.equal(totalOccurrences(out, FAKE_CURSOR_START), 0);
    // The marker must sit on the content line, not the borders.
    assert.ok(
      out.slice(1, -1).some((line) => line.includes(CURSOR_MARKER)),
      `expected marker on a content line, got ${JSON.stringify(out)}`,
    );
  });
});
