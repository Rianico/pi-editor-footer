/**
 * pi-tui scroll-border compatibility (0.84.2 → 1.3.0).
 *
 * `createScrollBorder()` changed shape in pi-tui 1.3.0:
 *   0.84.2: `─── ↑ 3 more ─────…`  (label anchored left, always)
 *   1.3.0 : `────── ↑ 3 more ─────` (label centred when it fits)
 *
 * `BorderRenderer` owns the top/bottom border lines, so it must still
 * *recognise* an editor scroll border in either shape: a top scroll border is
 * left untouched (it carries pi's own scroll hint), and a bottom scroll border
 * is still the bottom border we embed telemetry into.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BorderRenderer } from "../src/border-renderer.js";
import { stripAnsi } from "../src/format.js";
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

  test("1.3.0 centred bottom scroll border is still the bottom border", () => {
    const out = renderer().renderWithBorders(
      [bar(), "typed text", centredScrollBorder("↓", 2)],
      WIDTH,
      {
        glowEnabled: false,
        telemetryText: TELEMETRY,
      },
    );
    assert.match(stripAnsi(out[out.length - 1] ?? ""), /TPS 60\.0 tok\/s/);
  });

  test("legacy left-anchored bottom scroll border is still the bottom border", () => {
    const out = renderer().renderWithBorders(
      [bar(), "typed text", legacyScrollBorder("↓", 2)],
      WIDTH,
      {
        glowEnabled: false,
        telemetryText: TELEMETRY,
      },
    );
    assert.match(stripAnsi(out[out.length - 1] ?? ""), /TPS 60\.0 tok\/s/);
  });
});
