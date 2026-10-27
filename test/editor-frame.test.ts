/**
 * Rounded editor frame (ADR-0004 rev 2, #54).
 *
 * The frame replaces the editor's border rows with `╭ ─ ╮ │ ╰ ─ ╯`, spends
 * `EDITOR_FRAME_CHROME` columns on rails + inner padding (so the body renders at
 * `width - 4`), and does not exist at all at narrow widths. What must never move:
 * the usage/status row above it (#55) — same bytes, still the first row — and pi's
 * scroll hints, which survive as labels INSIDE the frame rules.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BorderRenderer,
  EDITOR_FRAME_CHROME,
  FRAME_GLYPHS,
  MIN_FRAMED_WIDTH,
  editorFramePlan,
  rowsPrependedAboveEditor,
} from "../src/border-renderer.js";
import { resolveGlyphs } from "../src/icons.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../src/format.js";

const identity = (s: string): string => s;
const theme = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: (level: string) => (s: string) => `<glow:${level}>${s}</glow>`,
  fg: (_style: string, s: string) => s,
  bold: identity,
  dim: identity,
  muted: identity,
};
const model = {
  provider: "opencode-go",
  modelId: "deepseek-v4.1-flash",
  level: "high",
  contextWindow: 1_000_000,
};

function renderer(): BorderRenderer {
  return new BorderRenderer(
    () => theme as never,
    () => model,
  );
}

const body = (line = ""): string[] => ["─".repeat(100), line, "─".repeat(100)];
const plain = (rows: string[]): string[] => rows.map((r) => stripAnsi(r));
const USAGE = " ⠋ Working | ↑ 14M · ↓ 89k · $0.15 · T1 · 8s · 2 tools";

describe("editorFramePlan", () => {
  test("framed widths hand the body width - EDITOR_FRAME_CHROME columns", () => {
    assert.equal(EDITOR_FRAME_CHROME, 4);
    assert.deepEqual(editorFramePlan(100), { framed: true, bodyWidth: 96 });
    assert.deepEqual(editorFramePlan(31), { framed: true, bodyWidth: 27 });
  });

  test("30 and below render unframed, so the body keeps the full width", () => {
    for (const width of [MIN_FRAMED_WIDTH, 20, 5]) {
      assert.deepEqual(editorFramePlan(width), { framed: false, bodyWidth: width });
    }
  });
});

describe("frame compositor", () => {
  test("100 columns: rounded corners, rails, one column of inner padding", () => {
    const rows = plain(
      renderer().renderWithBorders(body("> add a route"), 100, { glowEnabled: false }),
    );
    assert.equal(rows.length, 3);
    assert.match(rows[0] ?? "", /^╭─.*─╮$/);
    assert.equal(rows[2], `╰${"─".repeat(98)}╯`);
    assert.equal(rows[1], `│ > add a route${" ".repeat(83)} │`);
    for (const row of rows)
      assert.equal(visibleWidth(row ?? ""), 100, `row must be exactly 100: ${row}`);
  });

  test("60 columns: same geometry", () => {
    const rows = plain(renderer().renderWithBorders(body("hello"), 60, { glowEnabled: false }));
    assert.equal(rows[1], `│ hello${" ".repeat(51)} │`);
    assert.equal(visibleWidth(rows[0] ?? ""), 60);
    assert.equal(visibleWidth(rows[1] ?? ""), 60);
    assert.equal(visibleWidth(rows[2] ?? ""), 60);
  });

  test("30 and below: no frame at all, pi's rows pass through", () => {
    for (const width of [30, 20]) {
      const rows = plain(
        renderer().renderWithBorders(body("hello"), width, { glowEnabled: false }),
      );
      assert.ok(
        !rows.some((r) => /[╭╮╰╯│]/.test(r)),
        `no frame glyphs at ${width}: ${rows.join("/")}`,
      );
      assert.equal(rows[1], "hello");
    }
  });

  // `icons.mode` swaps icon *sets*; box drawing is chrome, not an icon, so the frame
  // must be identical in both modes. The resolvers are consulted here (not the raw
  // constant) so the test also proves the two modes really do differ — otherwise the
  // assertion would hold vacuously.
  test("box drawing is mode-independent: ascii glyph resolution does not touch the frame", () => {
    const ascii = resolveGlyphs("ascii");
    const nerd = resolveGlyphs("nerd");
    assert.notDeepEqual(ascii, nerd, "the two modes must differ, or the pin is vacuous");
    assert.notEqual(ascii.git, nerd.git, "the modes really do swap glyphs");
    assert.equal(ascii.git, "", "ascii drops the nerd icon rather than substituting a box glyph");

    // The frame never reads the glyph set — it is the same rows either way.
    const rows = plain(
      renderer().renderWithBorders(body("hello"), 60, {
        glowEnabled: false,
        topContextText: "14.6% · 146k",
      }),
    );
    assert.match(rows[0] ?? "", /^╭─/);
    assert.match(rows[0] ?? "", /╮$/);
    assert.match(rows[1] ?? "", /^│ .* │$/);
    assert.match(rows[2] ?? "", /^╰─+╯$/);
    for (const glyph of Object.values(FRAME_GLYPHS)) assert.ok(glyph.length === 1);
    assert.deepEqual(Object.values(FRAME_GLYPHS), ["╭", "╮", "╰", "╯", "│", "─"]);
  });

  test("top rule carries the model field then the context field, bottom the telemetry", () => {
    const rows = plain(
      renderer().renderWithBorders(body(), 100, {
        glowEnabled: false,
        topContextText: "14.6% · 146k/1.0M",
        telemetryText: "TPS 60.6 tok/s · TTFT 2.5s",
      }),
    );
    assert.match(
      rows[0] ?? "",
      /╭─ opencode-go\/deepseek-v4\.1-flash · <glow:high>high<\/glow> \| 14\.6% · 146k\/1\.0M ─+╮/,
    );
    assert.match(rows[2] ?? "", /╰─+ TPS 60\.6 tok\/s · TTFT 2\.5s ─╯/);
  });

  test("the glow owns all four sides, rails included", () => {
    const rows = renderer().renderWithBorders(body("hi"), 60, { glowEnabled: true });
    for (const row of rows) {
      assert.match(row, /^<glow:high>/, `row must open with the thinking glow: ${row}`);
      assert.match(row, /<\/glow>$/, `row must close the glow: ${row}`);
    }
  });

  test("an empty input line is framed as a blank body row", () => {
    const rows = plain(
      renderer().renderWithBorders(["─".repeat(60), "", "─".repeat(60)], 60, {
        glowEnabled: false,
      }),
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[1]?.length, 60);
    assert.match(rows[1] ?? "", /^│ +│$/);
  });

  test("long body lines are clipped to the body width, never doubling a rail", () => {
    const long = "x".repeat(200);
    const rows = plain(renderer().renderWithBorders(body(long), 60, { glowEnabled: false }));
    assert.equal(visibleWidth(rows[1] ?? ""), 60);
    assert.equal((rows[1] ?? "").match(/│/g)?.length, 2, "exactly two rails");
  });
});

describe("scroll hints survive inside the frame", () => {
  const scrollBorder = (width: number, dir: string, n: number): string => {
    const label = ` ${dir} ${n} more `;
    const left = Math.floor((width - label.length) / 2);
    return "─".repeat(left) + label + "─".repeat(width - left - label.length);
  };

  test("top and bottom hints become labels in the frame rules", () => {
    const rows = plain(
      renderer().renderWithBorders(
        [scrollBorder(100, "↑", 3), "line 5", scrollBorder(100, "↓", 2)],
        100,
        { glowEnabled: false, telemetryText: "TPS 60.6 tok/s" },
      ),
    );
    assert.match(rows[0] ?? "", /^╭─ ↑ 3 more ─ .*─+╮$/);
    assert.match(rows[2] ?? "", /^╰─ ↓ 2 more ─+ TPS 60\.6 tok\/s ─╯$/);
  });

  test("unframed widths keep pi's scroll border byte-for-byte", () => {
    const lines = [scrollBorder(20, "↑", 3), "line", scrollBorder(20, "↓", 2)];
    const rows = renderer().renderWithBorders(lines, 20, { glowEnabled: true });
    assert.equal(stripAnsi(rows[0] ?? ""), lines[0]);
    assert.equal(stripAnsi(rows[2] ?? ""), lines[2]);
  });
});

describe("#55 handoff: the usage row above the frame is untouched", () => {
  test("same bytes, same position — first row, above the frame", () => {
    // Same composition on both paths: a short usage row cannot be truncated by the
    // narrow unframed width, so the comparison is byte-exact rather than prefix.
    const opts = {
      glowEnabled: false,
      topTokensText: "↑ 14M",
      workingText: "⠋ Working",
    };
    const unframed = renderer().renderWithBorders(body(), 30, opts);
    const framed = renderer().renderWithBorders(body(), 100, opts);
    assert.equal(unframed[0], framed[0], "the line is byte-identical with and without the frame");
    assert.equal(framed[0], " ⠋ Working | ↑ 14M");
    assert.match(stripAnsi(framed[1] ?? ""), /^╭─/, "the frame starts on the next row");
    assert.equal(rowsPrependedAboveEditor({ usageRow: true }), 1);
  });

  test("the composed status | run | stall row is preserved verbatim", () => {
    const rows = renderer().renderWithBorders(body(), 100, {
      glowEnabled: false,
      topTokensText: "↑ 14M · ↓ 89k · $0.15",
      topRightText: "T1 · 8s · 2 tools",
      workingText: "⠋ Working",
    });
    assert.equal(stripAnsi(rows[0] ?? ""), USAGE);
  });
  test("status row above the usage row, both above the frame", () => {
    const rows = renderer().renderWithBorders(body(), 100, {
      glowEnabled: false,
      statusLineText: "Retrying (1/3) …",
      workingText: "⠋ Working",
      topTokensText: "↑ 14M",
    });
    assert.equal(stripAnsi(rows[0] ?? ""), " Retrying (1/3) …");
    assert.equal(stripAnsi(rows[1] ?? ""), " ⠋ Working | ↑ 14M");
    assert.match(stripAnsi(rows[2] ?? ""), /^╭─/);
    assert.equal(rowsPrependedAboveEditor({ statusRow: true, usageRow: true }), 2);
  });

  test("idle: no usage row, the frame is the first row", () => {
    const rows = renderer().renderWithBorders(body("hi"), 100, { glowEnabled: false });
    assert.match(stripAnsi(rows[0] ?? ""), /^╭─/);
  });
});
