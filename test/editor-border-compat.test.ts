/**
 * pi-tui scroll-border compatibility (0.84.2 → 1.3.0).
 *
 * `createScrollBorder()` changed shape in pi-tui 1.3.0:
 *   0.84.2: `─── ↑ 3 more ─────…`  (label anchored left, always)
 *   1.3.0 : `────── ↑ 3 more ─────` (label centred when it fits)
 *
 * `BorderRenderer` owns the top/bottom border lines, so it must still
 * *recognise* an editor scroll border in every shape: a scroll border carries
 * pi's own `↑`/`↓ N more` hint, so embedding is skipped for it and only applies
 * to non-scrolled borders. 1.3.0 adds a third shape: when even the indicator does
 * not fit, `createScrollBorder()` slices it by column and appends the ellipsis
 * (`─── ↑ 3 mo...`, `─── ↑ ...`, `─── ...`).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Editor } from "@earendil-works/pi-tui";
import { BorderRenderer } from "../src/border-renderer.js";
import { stripAnsi } from "../src/format.js";
import { isEditorScrollBorderLine } from "../src/layout.js";
import type { ModelInfo, ThemeLike } from "../src/model-info.js";

const WIDTH = 40;

function theme(): ThemeLike {
  const id = (s: string): string => s;
  return {
    getFgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => id,
    fg: (_style: string, s: string) => s,
    bold: id,
    dim: id,
    muted: id,
  };
}

function model(): ModelInfo {
  return { provider: "p", modelId: "m", level: "high", contextWindow: 1_000_000 };
}

function renderer(): BorderRenderer {
  return new BorderRenderer(theme, model);
}

const bar = (): string => "─".repeat(WIDTH);

/** pi-tui 1.3.0 centred scroll border, as `createScrollBorder()` emits it. */
function centredScrollBorder(dir: "↑" | "↓", n: number): string {
  const label = ` ${dir} ${n} more `;
  const left = Math.floor((WIDTH - label.length) / 2);
  return "─".repeat(left) + label + "─".repeat(WIDTH - left - label.length);
}

/** pi-tui 0.84.2 left-anchored scroll border. */
function legacyScrollBorder(dir: "↑" | "↓", n: number): string {
  const indicator = `─── ${dir} ${n} more `;
  return indicator + "─".repeat(WIDTH - indicator.length);
}

const TELEMETRY = "TPS 60.0 tok/s";

describe("BorderRenderer × pi-tui scroll borders", () => {
  test("1.3.0 centred top scroll border is left untouched", () => {
    const border = centredScrollBorder("↑", 3);
    const out = renderer().renderWithBorders([border, "typed text", bar()], WIDTH, {
      glowEnabled: true,
      topContextText: "39.6% · 416k/1.0M",
    });
    assert.match(stripAnsi(out[0] ?? ""), /↑ 3 more/, "pi's scroll hint must survive");
    assert.doesNotMatch(stripAnsi(out[0] ?? ""), /39\.6%/, "top border must not be embedded over");
  });

  test("legacy left-anchored top scroll border is still left untouched", () => {
    const border = legacyScrollBorder("↑", 3);
    const out = renderer().renderWithBorders([border, "typed text", bar()], WIDTH, {
      glowEnabled: true,
      topContextText: "39.6% · 416k/1.0M",
    });
    assert.match(stripAnsi(out[0] ?? ""), /↑ 3 more/);
    assert.doesNotMatch(stripAnsi(out[0] ?? ""), /39\.6%/);
  });

  test("1.3.0 centred bottom scroll border keeps pi's hint", () => {
    const out = renderer().renderWithBorders(
      [bar(), "typed text", centredScrollBorder("↓", 2)],
      WIDTH,
      {
        glowEnabled: false,
        telemetryText: TELEMETRY,
      },
    );
    assert.match(stripAnsi(out[out.length - 1] ?? ""), /↓ 2 more/);
    assert.doesNotMatch(stripAnsi(out[out.length - 1] ?? ""), /TPS/);
  });

  test("legacy left-anchored bottom scroll border keeps pi's hint", () => {
    const out = renderer().renderWithBorders(
      [bar(), "typed text", legacyScrollBorder("↓", 2)],
      WIDTH,
      {
        glowEnabled: false,
        telemetryText: TELEMETRY,
      },
    );
    assert.match(stripAnsi(out[out.length - 1] ?? ""), /↓ 2 more/);
    assert.doesNotMatch(stripAnsi(out[out.length - 1] ?? ""), /TPS/);
  });
});

/**
 * Real 1.3.0 shapes, straight out of `Editor.render()`: the label is centred
 * while it fits (width ≥ 12 here), then `createScrollBorder` slices the
 * left-anchored indicator by column and appends a 1–3 dot ellipsis. The
 * left-anchored `─── ↑ N more ──` branch is shadowed in 1.3.0 (its indicator is
 * exactly three columns wider than the centred label), so it is only reachable
 * as the 0.84.2 shape — covered by the hand-built fixtures above.
 */
const VIEWPORT_LINES = 12;
const editorTui = {
  requestRender: () => {},
  setShowHardwareCursor: () => {},
  terminal: { rows: 24, columns: 80, write: () => {} },
};
const editorTheme = { borderColor: (s: string) => s, selectList: {} };

/** A genuinely scrolled editor: content above (`↑`) and below (`↓`) the viewport. */
function scrolledEditorLines(width: number): string[] {
  const editor = new Editor(editorTui as never, editorTheme as never);
  const text = Array.from({ length: VIEWPORT_LINES }, (_, i) => `line ${i + 1}`);
  editor.setText(text.join("\n"));
  editor.focused = true;
  for (let i = 0; i < 4; i++) editor.handleInput("\x1b[A");
  return editor.render(width);
}

/** Widths that exercise each 1.3.0 branch: centred, truncated-with-label, dashes-only. */
const SHAPE_WIDTHS = [60, 20, 12, 11, 10, 9, 8, 7, 6, 5] as const;

describe("pi-tui 1.3.0 scroll-border shape matrix (real renderer)", () => {
  test("the fixture really is a scrolled editor (both indicators present)", () => {
    const lines = scrolledEditorLines(WIDTH);
    const top = stripAnsi(lines[0] ?? "");
    const bottom = stripAnsi(lines[lines.length - 1] ?? "");
    assert.match(top, /↑ \d+ more/);
    assert.match(bottom, /↓ \d+ more/);
  });

  for (const width of SHAPE_WIDTHS) {
    test(`top scroll border survives border rendering at width ${width}`, () => {
      const lines = scrolledEditorLines(width);
      const top = lines[0] ?? "";
      const bottom = lines[lines.length - 1] ?? "";

      assert.ok(
        isEditorScrollBorderLine(top),
        `top must be recognised as a scroll border: ${JSON.stringify(top)}`,
      );
      assert.ok(
        isEditorScrollBorderLine(bottom),
        `bottom must be recognised as a scroll border: ${JSON.stringify(bottom)}`,
      );

      const out = renderer().renderWithBorders(lines, width, {
        glowEnabled: true,
        topContextText: "39.6% · 416k/1.0M",
      });

      assert.equal(out[0], top, "pi's scroll hint must survive byte-for-byte");
      assert.doesNotMatch(stripAnsi(out[0] ?? ""), /39\.6%/);
    });
  }

  for (const width of [WIDTH, 10] as const) {
    test(`bottom scroll border keeps pi's ↓ hint at width ${width}`, () => {
      const lines = scrolledEditorLines(width);
      const bottom = lines[lines.length - 1] ?? "";

      const out = renderer().renderWithBorders(lines, width, {
        glowEnabled: false,
        telemetryText: TELEMETRY,
      });

      assert.equal(out[out.length - 1], bottom, "pi's ↓ hint must survive byte-for-byte");
      assert.doesNotMatch(stripAnsi(out[out.length - 1] ?? ""), /TPS/);
    });
  }

  test("non-scrolled plain borders still get top context and bottom telemetry", () => {
    const lines = [bar(), "typed text", bar()];

    const out = renderer().renderWithBorders(lines, WIDTH, {
      glowEnabled: true,
      topContextText: "39.6% · 416k/1.0M",
      telemetryText: TELEMETRY,
    });

    assert.match(stripAnsi(out[0] ?? ""), /39\.6%/);
    assert.doesNotMatch(stripAnsi(out[0] ?? ""), /↑|↓/);
    assert.match(stripAnsi(out[out.length - 1] ?? ""), /TPS 60\.0 tok\/s/);
    assert.doesNotMatch(stripAnsi(out[out.length - 1] ?? ""), /↑|↓/);
  });
});

describe("isEditorScrollBorderLine shape matrix", () => {
  const scroll = [
    // 1.3.0 centred (label fits)
    "──────── ↑ 3 more ────────",
    "─ ↑ 3 more ──",
    // 1.3.0 truncated + ellipsis (label does not fit)
    "─── ↑ 3 ...",
    "─── ↑ 3...",
    "─── ↑ ...",
    "─── ↑...",
    "─── ↑ 3 mo...",
    // 1.3.0 truncated before the arrow lands
    "─── ...",
    "───...",
    "──...",
    "─...",
    // 0.84.2 left-anchored
    "─── ↑ 3 more ────────────────────",
    "─── ↓ 28 more ",
  ];
  for (const line of scroll) {
    test(`scroll: ${JSON.stringify(line)}`, () => {
      assert.equal(isEditorScrollBorderLine(line), true);
    });
  }

  const notScroll = [
    "─".repeat(WIDTH),
    "typed text ↑ 3 more",
    "hello ...",
    "...",
    "",
    "───── ─────",
  ];
  for (const line of notScroll) {
    test(`not scroll: ${JSON.stringify(line)}`, () => {
      assert.equal(isEditorScrollBorderLine(line), false);
    });
  }
});
