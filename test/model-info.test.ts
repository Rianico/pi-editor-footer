/**
 * Model label rendering (ADR-0004 "Provider").
 *
 * One identity, not a path with a filename: the provider joins the model id in
 * the accent+bold run, the `/` between them stays dim, an absent provider
 * renders nothing at all (no dangling slash), and an unknown model still falls
 * back to `unknown`. The ` · ` separator and the thinking-level glow are
 * unchanged by the provider decision, so they are pinned here too.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildLabel, type ThemeLike } from "../src/model-info.js";

/** Distinguishable markers per theme slot, so a segment assertion can name its style. */
const theme: ThemeLike = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: (level: string) => (s: string) => `<glow ${level}>${s}</glow>`,
  fg: (style: string, s: string) => `[${style}]${s}[/]`,
  bold: (s: string) => `<b>${s}</b>`,
  dim: (s: string) => `[dim]${s}[/]`,
  muted: (s: string) => s,
};

const ACCENT = (s: string): string => `[accent]<b>${s}</b>[/]`;

describe("buildLabel (ADR-0004 provider joins the model's accent+bold)", () => {
  test("provider and model are one accent+bold identity, split by a dim slash", () => {
    const label = buildLabel(theme, "opencode-go", "deepseek-v4.1-flash", "high", 1_000_000);
    assert.equal(
      label,
      `${ACCENT("opencode-go")}[dim]/[/]${ACCENT("deepseek-v4.1-flash")}[dim] · [/]<glow high>high</glow>`,
    );
  });

  test("model only: an empty provider renders nothing, not a dangling slash", () => {
    const label = buildLabel(theme, "", "deepseek-v4.1-flash", "high", 1_000_000);
    assert.equal(label, `${ACCENT("deepseek-v4.1-flash")}[dim] · [/]<glow high>high</glow>`);
    assert.ok(!label.includes("[dim]/[/]"), "no separator survives an absent provider");
  });

  test("model only: a missing provider degrades the same way", () => {
    const label = buildLabel(
      theme,
      undefined as unknown as string,
      "deepseek-v4.1-flash",
      "high",
      1_000_000,
    );
    assert.equal(label, `${ACCENT("deepseek-v4.1-flash")}[dim] · [/]<glow high>high</glow>`);
  });

  test("unknown model still falls back to `unknown`, provider styling unchanged", () => {
    const label = buildLabel(theme, "opencode-go", "", "low", 200_000);
    assert.equal(
      label,
      `${ACCENT("opencode-go")}[dim]/[/]${ACCENT("unknown")}[dim] · [/]<glow low>low</glow>`,
    );
  });
});
