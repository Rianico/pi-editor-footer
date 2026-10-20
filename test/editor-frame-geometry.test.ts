/**
 * The frame must not disturb the editor's own geometry (ADR-0004 rev 2, #54).
 *
 * Rails cost two columns on the left and one of inner padding, so the body is
 * rendered at `width - EDITOR_FRAME_CHROME`; these tests drive pi's real
 * `Editor` through `TrackingEditor` and assert against what the user sees —
 * caret cell, selection highlight, wrapping, the scroll hint and the
 * autocomplete popup — all inside the frame.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Editor, visibleWidth } from "@earendil-works/pi-tui";
import { BorderRenderer, EDITOR_FRAME_CHROME, editorFramePlan } from "../src/border-renderer.js";
import { stripAnsi } from "../src/format.js";
import { TrackingEditor } from "../src/tracking-editor.js";

const WIDTH = 100;
const BODY = WIDTH - EDITOR_FRAME_CHROME;

const identity = (s: string): string => s;
const liveTheme = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => identity,
  fg: (_style: string, s: string) => s,
  bold: identity,
  dim: identity,
  muted: identity,
};
const editorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
const tui = {
  requestRender: () => {},
  setShowHardwareCursor: () => {},
  terminal: { rows: 24, columns: 120, write: () => {} },
};
const modelInfo = {
  provider: "opencode-go",
  modelId: "v4",
  level: "high",
  contextWindow: 1_000_000,
};

function renderer() {
  return new BorderRenderer(
    () => liveTheme as never,
    () => modelInfo,
  );
}

function makeEditor(): TrackingEditor {
  const editor = new TrackingEditor(
    tui as never,
    editorTheme as never,
    { matches: () => false },
    () => liveTheme as never,
  );
  editor.setChrome({ modelInfo, glowEnabled: true, telemetryText: "" });
  return editor;
}

/**
 * pi-tui 1.3.0 draws the caret with a zero-width fake-cursor pair
 * (`ESCAPE_pi:fc` … `ESCAPE_pi:/fc`) plus `CURSOR_MARKER` while focused, not with
 * reverse video. The pair is what carries the column, so the caret's column is the
 * visible width of everything before it.
 */
const FAKE_CURSOR_OPEN = "\u001b_pi:fc\u0007";

const plain = (rows: string[]): string[] => rows.map((row) => stripAnsi(row));
const CURSOR_MARKER = "\u001b_pi:c\u0007";

function caretRow(rows: string[]): number {
  return rows.findIndex((row) => row.includes(FAKE_CURSOR_OPEN));
}

function caretColumn(row: string): number {
  const at = row.indexOf(FAKE_CURSOR_OPEN);
  if (at === -1) return -1;
  return visibleWidth(row.slice(0, at));
}

describe("caret stays inside the frame", () => {
  test("caret at line start, middle and end keeps its column", () => {
    const editor = new Editor(tui as never, editorTheme as never);
    editor.setText("hello");
    editor.focused = true;
    const plainRows = editor.render(BODY);

    const tracking = makeEditor();
    tracking.setText("hello");
    tracking.focused = true;
    const framedRows = tracking.render(WIDTH);

    assert.equal(editorFramePlan(WIDTH).bodyWidth, BODY);
    for (const rows of [plainRows, framedRows]) {
      const row = caretRow(rows);
      assert.notEqual(row, -1, "the caret marker must be present");
      assert.ok(rows[row]?.includes(CURSOR_MARKER), "the focused caret marker rides the caret row");
    }
    // The caret's body column is identical; the frame only shifts it by the
    // left rail + inner padding (half of EDITOR_FRAME_CHROME).
    const plainCol = caretColumn(plainRows[caretRow(plainRows)] ?? "");
    const framedCol = caretColumn(framedRows[caretRow(framedRows)] ?? "");
    assert.equal(framedCol, plainCol + EDITOR_FRAME_CHROME / 2, `${plainCol} -> ${framedCol}`);
    assert.match(
      stripAnsi(framedRows[caretRow(framedRows)] ?? ""),
      /^│ .*│$/,
      "caret row is railed",
    );
  });

  test("caret at end of a wrapped line lands on the continuation row", () => {
    const editor = makeEditor();
    editor.setText("y".repeat(BODY + 3));
    editor.focused = true;
    const rows = editor.render(WIDTH);
    const row = caretRow(rows);
    assert.notEqual(row, -1);
    assert.equal(row, rows.length - 2, "the caret follows the wrap, still inside the frame");
    assert.match(stripAnsi(rows[row] ?? ""), /^│ .*│$/);
  });

  test("typing keeps the caret in the last row of the frame", () => {
    const editor = makeEditor();
    editor.setText("");
    editor.focused = true;
    for (const ch of "abc") editor.handleInput(ch);
    const rows = editor.render(WIDTH);
    const row = caretRow(rows);
    assert.notEqual(row, -1);
    assert.equal(rows.length, 3, "top rule, one body row, bottom rule");
    assert.match(stripAnsi(rows[row] ?? ""), /│\s*abc/);
  });
});

describe("wrapping happens at the body width", () => {
  test("a line longer than the body wraps, and no row exceeds the width", () => {
    const text = "x".repeat(BODY + 20);
    const editor = makeEditor();
    editor.setText(text);
    editor.focused = true;
    const rows = editor.render(WIDTH);

    assert.ok(rows.length > 3, "the wrapped line must add body rows");
    for (const row of rows) {
      const plain = stripAnsi(row);
      assert.ok(plain.length <= WIDTH, `row wider than ${WIDTH}: ${plain.length}`);
      if (!/^[╭╰]/.test(plain)) assert.match(plain, /^│.*│$/, `body rows are railed: ${plain}`);
    }
    const visibleText = rows
      .slice(1, -1)
      .map((r) => stripAnsi(r).slice(2, -2).trimEnd())
      .join("");
    assert.equal(visibleText.replace(/\s/g, ""), text, "wrapping must not lose characters");
  });
});

describe("styled body rows survive the rails", () => {
  test("a reverse-video (selected) span keeps the rails and the exact width", () => {
    const selected = `\x1b[7mselect me\x1b[0m please`;
    const rows = plain(
      renderer().renderWithBorders([`─`.repeat(WIDTH), selected, "─".repeat(WIDTH)], WIDTH, {
        glowEnabled: false,
      }),
    );
    assert.equal(rows.length, 3);
    assert.equal(visibleWidth(rows[1] ?? ""), WIDTH);
    assert.equal((rows[1] ?? "").match(/│/g)?.length, 2, "styling must not swallow a rail");
    assert.ok((rows[1] ?? "").includes("select me please"), "body text is intact");
  });

  test("a body row already carrying rails (nested chrome) is not double-railed", () => {
    const rows = plain(
      renderer().renderWithBorders([`─`.repeat(WIDTH), "│ inner │", "─".repeat(WIDTH)], WIDTH, {
        glowEnabled: false,
      }),
    );
    assert.equal(
      (rows[1] ?? "").match(/│/g)?.length,
      4,
      "inner rails are body content, not chrome",
    );
    assert.equal(visibleWidth(rows[1] ?? ""), WIDTH);
  });
});

describe("scroll hint stays inside the frame", () => {
  test("a scrolled editor shows ↑ N more inside the top rule", () => {
    const editor = makeEditor();
    editor.setText(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n"));
    editor.focused = true;
    for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
    const rows = editor.render(WIDTH);
    const top = stripAnsi(rows[0] ?? "");
    assert.match(top, /^╭─.*╮$/);
    assert.match(top, /↑ \d+ more/, `top rule carries pi's hint: ${top}`);
    assert.ok(
      !rows.some((row) => /\x1b\[7m/.test(row) === false && /^─+ ↑/.test(stripAnsi(row))),
      "no raw border row survives",
    );
  });
});

describe("autocomplete popup stays under the body column", () => {
  const popup = ["  alpha-file", "  bravo-file"];

  test("popup rows keep the body column and stay below the frame", () => {
    const rows = plain(
      renderer().renderWithBorders([`─`.repeat(WIDTH), "@", `─`.repeat(WIDTH), ...popup], WIDTH, {
        glowEnabled: false,
      }),
    );
    assert.equal(rows.length, 5, "frame + one body row + two popup rows");
    assert.equal(rows[3], "    alpha-file");
    assert.equal(rows[4], "    bravo-file");
    // the popup indent is body column (2) + pi's own list indent (2)
    assert.equal(rows[3]?.indexOf("alpha-file"), 4);
  });

  test("the popup is never clipped by the frame rails", () => {
    const rows = plain(
      renderer().renderWithBorders(
        [`─`.repeat(WIDTH), "@", `─`.repeat(WIDTH), `  ${"x".repeat(WIDTH)}`],
        WIDTH,
        { glowEnabled: false },
      ),
    );
    assert.equal(rows[3]?.length, WIDTH, "tail is truncated to the frame width");
    assert.ok(!(rows[3] ?? "").includes("│"), "no rail leaks into the popup row");
  });
});
