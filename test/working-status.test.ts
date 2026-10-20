/**
 * Working indicator placement (ADR-0004 rev 2, #55).
 *
 * pi hands every status indicator to the editor once it claims
 * `embedWorkingStatus`. The working one becomes the LEFTMOST section of the
 * existing usage row above the top rule (`⠋ Working · ↑ … · ↓ … · $… | T1 · …`),
 * the row exists even with no tokens/activity, and it disappears again when the
 * run ends. No new row is invented, nothing lands on the footer, and any
 * non-working kind (retry, compaction) must keep rendering above the editor —
 * pi has no fallback once the claim is made, so swallowing one would hide it.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BorderRenderer, rowsPrependedAboveEditor } from "../src/border-renderer.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { renderFooter } from "../src/footer.js";
import { emptyGitStatus } from "../src/git.js";
import { createInitialState } from "../src/state.js";
import { stripAnsi } from "../src/format.js";
import { TrackingEditor, type EmbeddableStatusIndicator } from "../src/tracking-editor.js";

const WIDTH = 100;
const TOKENS = "↑ 14M · ↓ 89k · $0.15";
const ACTIVITY = "T1 · 8s · 2 tools";

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
const modelInfo = { provider: "p", modelId: "m", level: "high", contextWindow: 1_000_000 };

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

/**
 * Stand-in for pi's StatusIndicator: `message` is the Loader field (private in
 * pi's type, a runtime property), `renderSpinnerInBorder` advances frames on
 * every call exactly like the real animated Loader.
 */
function indicator(spec: {
  kind: string;
  message?: string;
  frames?: readonly string[];
  border?: string;
}): EmbeddableStatusIndicator & { renders: number } {
  const frames = spec.frames ?? ["⠋"];
  const state = { renders: 0 };
  return {
    kind: spec.kind,
    message: spec.message,
    get renders() {
      return state.renders;
    },
    renderSpinnerInBorder: () => {
      const frame = frames[state.renders % frames.length] ?? "";
      state.renders += 1;
      return frame;
    },
    renderInBorder: () => spec.border ?? "",
  };
}

function renderer(): BorderRenderer {
  return new BorderRenderer(
    () => liveTheme as never,
    () => modelInfo,
  );
}

type RowsOpts = Omit<Parameters<BorderRenderer["renderWithBorders"]>[2], "glowEnabled"> & {
  glowEnabled?: boolean;
};

/** A real editor block: `[top border][content][bottom border]`, so the frame has a body. */
function renderRows(opts: RowsOpts) {
  return renderer().renderWithBorders(["─".repeat(WIDTH), "hello", "─".repeat(WIDTH)], WIDTH, {
    ...opts,
    glowEnabled: opts.glowEnabled ?? true,
  });
}

/** Prepended rows carry the chrome's one-column inset; content is what matters. */
function content(row: string | undefined): string {
  return (row ?? "").trimStart();
}

function makeEditor(overrides: { topTokensText?: string; topRightText?: string } = {}) {
  const editor = new TrackingEditor(
    tui as never,
    editorTheme as never,
    { matches: () => false },
    () => liveTheme as never,
  );
  editor.setChrome({
    modelInfo,
    glowEnabled: true,
    telemetryText: "",
    topTokensText: overrides.topTokensText ?? "",
    topRightText: overrides.topRightText ?? "",
  });
  return editor;
}

describe("usage row composition (BorderRenderer)", () => {
  test("working is the leftmost section, activity stays behind the field boundary", () => {
    const lines = renderRows({
      workingText: "⠋ Working",
      topTokensText: TOKENS,
      topRightText: ACTIVITY,
    });
    assert.equal(content(lines[0]), `⠋ Working · ${TOKENS} | ${ACTIVITY}`);
    assert.equal(lines.length, 4, "usage row + framed top rule, body row, bottom rule");
  });

  test("tokens off: working and activity are two fields", () => {
    const lines = renderRows({ workingText: "⠋ Working", topRightText: ACTIVITY });
    assert.equal(content(lines[0]), `⠋ Working | ${ACTIVITY}`);
  });

  test("neither tokens nor activity: the working segment brings the row into existence", () => {
    const lines = renderRows({ workingText: "⠋ Working" });
    assert.equal(content(lines[0]), "⠋ Working");
    assert.ok(!lines[0]?.includes("|"), "nothing to separate");
  });

  test("idle with nothing to show: no row at all", () => {
    const lines = renderRows({});
    assert.equal(rowsPrependedAboveEditor({ statusRow: false, usageRow: false }), 0);
    assert.ok(!lines[0]?.includes("Working"));
    assert.match(stripAnsi(lines[0] ?? ""), /^╭─/, "the frame is the first row");
    assert.equal(lines.length, 3);
  });

  test("idle with tokens/activity only: the row keeps exactly its previous contents", () => {
    const lines = renderRows({ topTokensText: TOKENS, topRightText: ACTIVITY });
    assert.equal(rowsPrependedAboveEditor({ usageRow: true }), 1);
    assert.equal(content(lines[0]), `${TOKENS} | ${ACTIVITY}`);
    assert.ok(!lines[0]?.includes("Working"));
  });

  test("a non-embedded status keeps its own row above the usage row", () => {
    const lines = renderRows({
      statusLineText: "Retrying (1/3) …",
      workingText: "⠋ Working",
      topTokensText: TOKENS,
    });
    assert.equal(content(lines[0]), "Retrying (1/3) …");
    assert.equal(content(lines[1]), `⠋ Working · ${TOKENS}`);
    assert.equal(rowsPrependedAboveEditor({ statusRow: true, usageRow: true }), 2);
  });
});

describe("TrackingEditor claims pi's embed contract", () => {
  test("embedWorkingStatus is claimed, with a setter pi can call", () => {
    const editor = makeEditor();
    assert.equal(editor.embedWorkingStatus, true);
    assert.equal(typeof editor.setWorkingStatusIndicator, "function");
  });

  test("the working segment rides the existing row and advances pi's spinner", () => {
    const editor = makeEditor({ topTokensText: TOKENS, topRightText: ACTIVITY });
    const working = indicator({ kind: "working", message: "Working", frames: ["⠋", "⠙"] });
    editor.setWorkingStatusIndicator(working);

    const first = editor.render(WIDTH);
    assert.equal(content(first[0]), `⠋ Working · ${TOKENS} | ${ACTIVITY}`);
    const second = editor.render(WIDTH);
    assert.equal(content(second[0]), `⠙ Working · ${TOKENS} | ${ACTIVITY}`);
    assert.ok(working.renders >= 2, "the real Loader frame is read on every render");
  });

  test("the message is the indicator's own, never hardcoded", () => {
    const editor = makeEditor();
    editor.setWorkingStatusIndicator(indicator({ kind: "working", message: "Compacting…" }));
    assert.equal(content(editor.render(WIDTH)[0]), "⠋ Compacting…");
  });

  test("clearing the indicator returns the line to its previous shape", () => {
    const editor = makeEditor({ topTokensText: TOKENS });
    const before = editor.render(WIDTH);
    editor.setWorkingStatusIndicator(indicator({ kind: "working", message: "Working" }));
    assert.equal(content(editor.render(WIDTH)[0]), `⠋ Working · ${TOKENS}`);
    editor.setWorkingStatusIndicator(undefined);
    const after = editor.render(WIDTH);
    assert.deepEqual(after, before);
    assert.equal(after.length, before.length);
    assert.ok(!after.some((line) => line.includes("Working")));
  });

  test("retry is not swallowed: it renders above the editor", () => {
    const editor = makeEditor({ topTokensText: TOKENS });
    editor.setWorkingStatusIndicator(
      indicator({ kind: "retry", border: "Retrying (1/3) … esc to interrupt" }),
    );
    const lines = editor.render(WIDTH);
    assert.equal(content(lines[0]), "Retrying (1/3) … esc to interrupt");
    assert.equal(content(lines[1]), TOKENS);
    assert.ok(!lines.some((line) => line.includes("⠋")), "no working spinner while retrying");
  });
});

describe("footer carries no working segment", () => {
  test("renderFooter left/stats are untouched and never mention working", () => {
    const config = {
      ...DEFAULT_CONFIG,
      icons: { ...DEFAULT_CONFIG.icons, mode: "ascii" as const },
    };
    const state = {
      ...createInitialState(),
      git: { ...emptyGitStatus(), branch: "main" },
      runtime: { name: "node", version: "26.8.1" },
    };
    const lines = renderFooter(
      120,
      state as never,
      config as never,
      liveTheme as never,
      {
        cwd: "/Users/test/repo",
        totals: { input: 14_000_000, output: 89_000, cacheRead: 0, cacheWrite: 0, cost: 0.15 },
      } as never,
    );
    const line = lines[0] ?? "";
    assert.ok(line.includes("@ /Users/test/repo  · main  | node 26.8.1"), line);
    assert.ok(line.includes("↑ 14M · ↓ 89k · $0.15"), line);
    assert.ok(!/working/i.test(line), "the working segment belongs to the editor usage row");
  });
});
