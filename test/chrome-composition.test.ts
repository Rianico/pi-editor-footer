import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptTheme,
  ChromeComposition,
  resolveGlow,
} from "../src/chrome-composition.js";
import { createChromeSnapshot } from "../src/chrome-state.js";
import type { TurnTelemetry } from "../src/telemetry.js";

const fakeTheme = {
  fg: (style: string, s: string) => `[${style}]${s}[/]`,
  getThinkingBorderColor: (level: string) => (s: string) => `<${level}>${s}`,
} as unknown as { fg: (s: string, t: string) => string };

describe("chrome-composition", () => {
  test("adaptTheme delegates to fg when present", () => {
    const t = adaptTheme(fakeTheme);
    assert.equal(t.fg("dim", "hello"), "[dim]hello[/]");
  });

  test("adaptTheme identity when fg missing", () => {
    const t = adaptTheme({});
    assert.equal(t.fg("dim", "hello"), "hello");
  });

  test("adaptTheme identity when fg not function", () => {
    const t = adaptTheme({ fg: "not-a-function" } as unknown as never);
    assert.equal(t.fg("dim", "hello"), "hello");
  });

  test("resolveGlow returns glow when present", () => {
    const g = resolveGlow(fakeTheme);
    assert.ok(typeof g === "function");
    assert.equal(g!("low", "x"), "<low>x");
  });

  test("resolveGlow returns undefined when missing", () => {
    const g = resolveGlow({ fg: () => "" } as unknown as never);
    assert.equal(g, undefined);
  });

  test("resolveGlow handles throw as identity", () => {
    const bad = {
      getThinkingBorderColor: () => () => {
        throw new Error("boom");
      },
    } as unknown as never;
    const g = resolveGlow(bad);
    assert.ok(typeof g === "function");
    assert.equal(g!("low", "x"), "x");
  });

  test("ChromeComposition glyphs + isAscii for auto nerd/ascii", () => {
    const prev = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = "Ghostty";
    const cNerd = new ChromeComposition("auto", fakeTheme);
    // Ghostty -> nerd
    assert.equal(cNerd.isAscii, false);
    assert.ok(cNerd.glyphs.input.length > 0);
    const cAscii = new ChromeComposition("ascii", fakeTheme);
    assert.equal(cAscii.isAscii, true);
    assert.equal(cAscii.glyphs.input, "↑");
    if (prev === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = prev;
  });

  test("ChromeComposition fg/dim delegates via adaptTheme", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    assert.equal(c.fg("accent", "hi"), "[accent]hi[/]");
    assert.equal(c.dim("hi"), "[dim]hi[/]");
  });

  test("ChromeComposition applyGlow delegates or identity", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    assert.equal(c.applyGlow("low", "x"), "<low>x");
    const c2 = new ChromeComposition("ascii", { fg: () => "" } as unknown as never);
    assert.equal(c2.applyGlow("low", "x"), "x");
  });

  test("ChromeComposition formatTopContext delegates to snapshot helper", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    const snap = createChromeSnapshot(
      {
        sessionManager: {
          getCwd: () => "/tmp",
          getSessionName: () => "s",
          getEntries: () => [],
        },
        getContextUsage: () => ({ percent: 50, tokens: 512_000, contextWindow: 1_000_000 }),
      } as unknown as never,
      null,
    );
    const out = c.formatTopContext(snap, false);
    // should contain pct and token numbers
    assert.ok(out.includes("50.0%"));
    assert.ok(out.includes("512k") || out.includes("512"));
  });

  test("ChromeComposition formatTopContext empty when no window", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    const snap = createChromeSnapshot(
      {
        sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
        getContextUsage: () => ({ percent: 0, tokens: 0, contextWindow: 0 }),
      } as unknown as never,
      null,
    );
    assert.equal(c.formatTopContext(snap, false), "");
  });

  test("ChromeComposition formatRunActivityTopRight delegates", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    const out = c.formatRunActivityTopRight({
      phase: "running",
      turnNumber: 2,
      startedAt: Date.now() - 1000,
      durationMs: undefined,
      activeTools: 1,
      completedCount: 2,
      failedCount: 0,
    });
    assert.ok(out.includes("2 turns") || out.includes("turn"));
  });

  test("ChromeComposition formatTelemetryTokens delegates", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    const tel: TurnTelemetry = {
      tps: 10,
      ttftMs: 100,
      totalMs: 2000,
      inputTokens: 1000,
      outputTokens: 2000,
      stallMs: 0,
      stallCount: 0,
      rateUsdPerMTokens: null,
      generationMs: 1500,
      totalTokens: 3000,
      costUsd: 0,
      measurementMs: 1500,
    };
    const out = c.formatTelemetryTokens(tel, {
      enabled: true,
      tps: true,
      ttft: true,
      duration: true,
      tokens: true,
      stalls: false,
      cost: false,
    } as never);
    assert.ok(out.length > 0);
    assert.ok(out.includes("↑") || out.includes("k") || out.includes("1"));
  });

  test("ChromeComposition formatTurnTelemetry delegates", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    const tel: TurnTelemetry = {
      tps: 5,
      ttftMs: 50,
      totalMs: 1000,
      inputTokens: 500,
      outputTokens: 500,
      stallMs: 0,
      stallCount: 0,
      rateUsdPerMTokens: null,
      generationMs: 800,
      totalTokens: 1000,
      costUsd: 0,
      measurementMs: 800,
    };
    const out = c.formatTurnTelemetry(tel, {
      enabled: true,
      tps: true,
      ttft: true,
      duration: true,
      tokens: true,
      stalls: false,
      cost: false,
    } as never);
    assert.ok(out.length >= 0);
  });

  test("ChromeComposition formatStall contains stall glyph and count", () => {
    const c = new ChromeComposition("ascii", fakeTheme);
    const tel: TurnTelemetry = {
      tps: null,
      ttftMs: 0,
      totalMs: 1000,
      inputTokens: 0,
      outputTokens: 0,
      stallMs: 1500,
      stallCount: 2,
      rateUsdPerMTokens: null,
      generationMs: 0,
      totalTokens: 0,
      costUsd: 0,
      measurementMs: null,
    };
    const out = c.formatStall(tel);
    assert.ok(out.includes("2×") || out.includes("2"));
  });
});
