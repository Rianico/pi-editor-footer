/**
 * Rendered-row → logical-line mapping for editor mouse clicks (issue #41).
 *
 * pi-tui 1.3.0 added `Editor.handleMouse`, which indexes rows relative to the
 * editor's own output: `[top border][content…][bottom border][autocomplete…]`.
 * `BorderRenderer.renderWithBorders` prepends the token row above that top
 * border when `topTokensText` is set (telemetry default), shifting every editor
 * row down by one. These tests click the rows the user actually sees and assert
 * the logical line the editor lands on, with and without the token row and with
 * and without the autocomplete popup.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { rowsPrependedAboveEditor } from "../src/border-renderer.js";
import { stripAnsi } from "../src/format.js";
import { TrackingEditor } from "../src/tracking-editor.js";

const WIDTH = 40;
const TOKENS = "↑ 1.2k | ↓ 800 | $0.12";
const LOGICAL_LINES = ["alpha", "beta", "gamma", "delta"] as const;
const TEXT = LOGICAL_LINES.join("\n");

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
  terminal: { rows: 24, columns: 80, write: () => {} },
};

const modelInfo = { provider: "p", modelId: "m", level: "high", contextWindow: 1_000_000 };

function makeEditor(topTokensText: string): TrackingEditor {
  const editor = new TrackingEditor(
    tui as never,
    editorTheme as never,
    { matches: () => false },
    () => liveTheme as never,
  );
  editor.setChrome({ modelInfo, glowEnabled: true, topTokensText, telemetryText: "" });
  return editor;
}

/** A left-click on `y`, in component-local row coordinates (0 = first rendered row). */
function clickRow(editor: TrackingEditor, y: number, renderedRows: number): void {
  editor.handleMouse({
    type: "click",
    button: "left",
    x: 0,
    y,
    screenX: 0,
    screenY: y,
    width: WIDTH,
    height: renderedRows,
    shift: false,
    alt: false,
    ctrl: false,
  });
}

function rowOf(lines: string[], needle: string): number {
  const index = lines.findIndex((line) => stripAnsi(line).includes(needle));
  assert.notEqual(
    index,
    -1,
    `no rendered row contains ${JSON.stringify(needle)}: ${JSON.stringify(lines.map(stripAnsi))}`,
  );
  return index;
}

const autocompleteProvider: AutocompleteProvider = {
  triggerCharacters: ["@"],
  getSuggestions: async () => ({
    prefix: "@",
    items: [
      { value: "alpha", label: "alpha-file" },
      { value: "bravo-longer", label: "bravo-longer-file" },
    ],
  }),
  applyCompletion: (lines, cursorLine, cursorCol, item: AutocompleteItem, prefix: string) => {
    const line = lines[cursorLine] ?? "";
    const next = `${line.slice(0, cursorCol - prefix.length)}${item.value}${line.slice(cursorCol)}`;
    return {
      lines: [...lines.slice(0, cursorLine), next, ...lines.slice(cursorLine + 1)],
      cursorLine,
      cursorCol: cursorCol - prefix.length + item.value.length,
    };
  },
};

/** Render with the autocomplete popup open: `@` triggers it, the provider answers. */
async function renderWithAutocomplete(topTokensText: string): Promise<{
  editor: TrackingEditor;
  lines: string[];
}> {
  const editor = makeEditor(topTokensText);
  editor.setAutocompleteProvider(autocompleteProvider);
  editor.focused = true;
  editor.setText("");
  editor.handleInput("@");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { editor, lines: editor.render(WIDTH) };
}

describe("editor mouse mapping with/without the tokens row", () => {
  test("rowsPrependedAboveEditor mirrors BorderRenderer's extra rows", () => {
    assert.equal(rowsPrependedAboveEditor({}), 0);
    assert.equal(rowsPrependedAboveEditor({ usageRow: false }), 0);
    assert.equal(rowsPrependedAboveEditor({ usageRow: true }), 1);
    assert.equal(rowsPrependedAboveEditor({ statusRow: true }), 1);
    assert.equal(rowsPrependedAboveEditor({ statusRow: true, usageRow: true }), 2);
  });

  for (const topTokensText of ["", TOKENS] as const) {
    const label = topTokensText ? "with the tokens row" : "without the tokens row";

    test(`${label}: every rendered content row maps to its logical line`, () => {
      const editor = makeEditor(topTokensText);
      editor.setText(TEXT);
      editor.focused = true;
      const lines = editor.render(WIDTH);

      for (const [lineIndex, word] of LOGICAL_LINES.entries()) {
        editor.setText(TEXT);
        clickRow(editor, rowOf(lines, word), lines.length);
        assert.deepEqual(
          editor.getCursor(),
          { line: lineIndex, col: 0 },
          `${label}: row holding ${word} must place the cursor on logical line ${lineIndex}`,
        );
      }
    });
  }

  test("with the tokens row: the tokens row, top border and bottom border are inert", () => {
    const editor = makeEditor(TOKENS);
    editor.setText(TEXT);
    editor.focused = true;
    const lines = editor.render(WIDTH);

    // Park the cursor on the first logical line, then click chrome rows.
    clickRow(editor, rowOf(lines, "alpha"), lines.length);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });

    clickRow(editor, rowOf(lines, TOKENS), lines.length);
    assert.deepEqual(
      editor.getCursor(),
      { line: 0, col: 0 },
      "the tokens row must not move the cursor",
    );

    clickRow(editor, 1, lines.length);
    assert.deepEqual(
      editor.getCursor(),
      { line: 0, col: 0 },
      "the top border must not move the cursor",
    );

    clickRow(editor, lines.length - 1, lines.length);
    assert.deepEqual(
      editor.getCursor(),
      { line: 0, col: 0 },
      "the bottom border must not move the cursor",
    );
  });

  for (const topTokensText of ["", TOKENS] as const) {
    const label = topTokensText ? "with the tokens row" : "without the tokens row";

    test(`${label}: clicking the first autocomplete row selects the first item`, async () => {
      const { editor, lines } = await renderWithAutocomplete(topTokensText);

      clickRow(editor, rowOf(lines, "alpha-file"), lines.length);

      assert.equal(editor.getText(), "alpha");
    });
  }
});
