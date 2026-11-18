/**
 * `TrackingEditor.handleInput` ordering — the pi 1.5.x autocomplete page-key branch.
 *
 * pi's `CustomEditor` (pi-coding-agent 1.5.2,
 * `dist/modes/interactive/components/custom-editor.js:66-73`) runs popup page keys through
 * `super.handleInput` BEFORE any app action, so a user who binds `tui.select.pageUp` /
 * `pageDown` onto a key that also pastes an image (pi's own comment names Ctrl+V) still
 * pages the open popup. `TrackingEditor` replicates that class inline, so it must keep the
 * same order — and, with the popup closed, the 1.3.0 order byte-for-byte.
 *
 * Popup state is driven through the two pi-tui internals this extension already reads
 * (`autocompleteState`, `autocompleteList`), so the real base `handleInput` branch runs
 * instead of a mock of it.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getKeybindings,
  type Keybinding,
  type SelectItem,
  type SelectList,
} from "@earendil-works/pi-tui";
import { TrackingEditor } from "../src/tracking-editor.js";

const identity = (s: string): string => s;
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
const liveTheme = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => identity,
  fg: (_style: string, s: string) => s,
  bold: identity,
  dim: identity,
  muted: identity,
};

/** pi-tui's own page-down sequence: `getKeybindings().matches("\x1b[6~", "tui.select.pageDown")`. */
const PAGE_DOWN = "\x1b[6~";
const CTL_O = "\x0f";

const realKeybindings = getKeybindings();

/**
 * The user-rebinding hazard pi's comment describes: the page key still pastes an image, so
 * whichever check runs first wins. Actions not in `map` defer to pi-tui's real bindings.
 */
function reboundKeybindings(map: Record<string, string> = {}): {
  matches(data: string, action: string): boolean;
} {
  return {
    matches(data: string, action: string): boolean {
      const forced = map[action];
      if (forced !== undefined) return data === forced;
      // SAFETY: `action` arrives as a pi-tui binding id from `TrackingEditor.handleInput`;
      // an id pi-tui does not know resolves to no keys and matches false.
      return realKeybindings.matches(data, action as Keybinding);
    },
  };
}

interface PopupInternals {
  autocompleteState: "regular" | null;
  autocompleteList?: SelectList;
}

/** Open the popup through pi-tui's own internals: non-null state plus a list to page. */
function openPopup(editor: TrackingEditor, onPage: (data: string) => void): () => void {
  // SAFETY: private pi-tui interior seam — the same two internals the editor itself patches.
  const internals = editor as unknown as PopupInternals;
  // SAFETY: only the members the base autocomplete branch and syncHighlight touch.
  const list = {
    handleInput: onPage,
    getSelectedItem: (): SelectItem | null => null,
    onSelectionChange: undefined,
  } as unknown as SelectList;
  internals.autocompleteState = "regular";
  internals.autocompleteList = list;
  return () => {
    internals.autocompleteState = null;
    internals.autocompleteList = undefined;
  };
}

function makeEditor(keybindings: {
  matches(data: string, action: string): boolean;
}): TrackingEditor {
  return new TrackingEditor(
    tui as never,
    editorTheme as never,
    keybindings,
    () => liveTheme as never,
  );
}

describe("TrackingEditor.handleInput — 1.5.x popup page keys", () => {
  test("with the popup open, a page key pages the popup and never pastes", () => {
    const editor = makeEditor(reboundKeybindings({ "app.clipboard.pasteImage": PAGE_DOWN }));
    const paged: string[] = [];
    let pasted = 0;
    editor.onPasteImage = () => {
      pasted += 1;
    };
    openPopup(editor, (data) => paged.push(data));

    editor.handleInput(PAGE_DOWN);

    assert.deepEqual(paged, [PAGE_DOWN], "page key must reach the base autocomplete list");
    assert.equal(pasted, 0, "a page key must never trigger the paste path");
  });

  test("with the popup closed, the same key still pastes exactly as before", () => {
    const editor = makeEditor(reboundKeybindings({ "app.clipboard.pasteImage": PAGE_DOWN }));
    let pasted = 0;
    editor.onPasteImage = () => {
      pasted += 1;
    };

    editor.handleInput(PAGE_DOWN);

    assert.equal(pasted, 1, "closed popup keeps the 1.3.0 paste order");
  });

  test("with the popup open, a non-page registered action still runs", () => {
    const editor = makeEditor(reboundKeybindings({ "app.custom": CTL_O }));
    let ran = 0;
    editor.onAction("app.custom", () => {
      ran += 1;
    });
    const paged: string[] = [];
    openPopup(editor, (data) => paged.push(data));

    editor.handleInput(CTL_O);

    assert.equal(ran, 1, "only popup page keys are rerouted");
    assert.deepEqual(paged, []);
  });

  test("capturesViewportInput is inherited, never overridden", () => {
    const editor = makeEditor(reboundKeybindings());
    assert.equal(editor.capturesViewportInput, false);
    openPopup(editor, () => {});
    assert.equal(editor.capturesViewportInput, true);
    assert.equal(
      Object.getOwnPropertyDescriptor(TrackingEditor.prototype, "capturesViewportInput"),
      undefined,
      "the getter must come from pi-tui's Editor, not a subclass shadow",
    );
  });
});
