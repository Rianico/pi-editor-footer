/**
 * LiveBorder.render characterization (C3).
 *
 * The live render path is pure structure — rendered bytes must not drift. These
 * tests pin, per scenario: exactly ONE editor.setChrome per refresh (coalesced
 * draw), the merged field values, and the early-return branches (telemetry
 * off/on, stalls, context on/off, idle vs running).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LiveBorder, type LiveBorderDeps } from "../src/live-border.js";
import { DEFAULT_CONFIG, type ThemeConfig } from "../src/config.js";
import { stripAnsi } from "../src/format.js";
import type { TurnTelemetry } from "../src/telemetry.js";
import type { RunActivitySnapshot } from "../src/run-activity.js";
import type { ChromeSnapshot } from "../src/tracking-editor.js";

function tel(over: Partial<TurnTelemetry> = {}): TurnTelemetry {
  return {
    tps: 12.5,
    ttftMs: 1234,
    totalMs: 20000,
    inputTokens: 4321,
    outputTokens: 876,
    stallMs: 0,
    stallCount: 0,
    rateUsdPerMTokens: null,
    generationMs: 15000,
    totalTokens: 5197,
    costUsd: 0.12,
    measurementMs: 15000,
    ...over,
  };
}

function idleSnap(over: Partial<RunActivitySnapshot> = {}): RunActivitySnapshot {
  return { phase: "idle", activeTools: 0, completedCount: 0, failedCount: 0, ...over };
}

interface Harness {
  calls: Array<Partial<ChromeSnapshot>>;
  merged: Partial<ChromeSnapshot>;
  deps: LiveBorderDeps;
}

function harness(
  over: {
    config?: (c: ThemeConfig) => void;
    peekLive?: TurnTelemetry | null;
    lastTel?: TurnTelemetry | null;
    ledgerLive?: TurnTelemetry | null;
    runSnap?: RunActivitySnapshot;
    isRunning?: boolean;
    idleDisplay?: TurnTelemetry | null;
    incDisplay?: TurnTelemetry | null;
    noEditor?: boolean;
    noCtx?: boolean;
  } = {},
): Harness {
  const calls: Array<Partial<ChromeSnapshot>> = [];
  const merged: Partial<ChromeSnapshot> = {};
  const editor = {
    setChrome(patch: Partial<ChromeSnapshot>) {
      calls.push({ ...patch });
      Object.assign(merged, patch);
    },
  };
  const cfg = structuredClone(DEFAULT_CONFIG);
  // deterministic glyphs regardless of the host terminal (auto would follow TERM_PROGRAM)
  cfg.icons.mode = "ascii";
  over.config?.(cfg);
  const ctx = {
    mode: "tui",
    ui: {
      // identity fg keeps assertions on structure + text; hex tiers still emit SGR,
      // which stripAnsi removes
      theme: { fg: (_c: string, s: string) => s, getColorMode: () => "truecolor" },
      setEditorComponent: () => {},
      setWidget: () => {},
      notify: () => {},
    },
    sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
    getContextUsage: () => ({ percent: 50, tokens: 512000, contextWindow: 1000000 }),
    model: { provider: "p", id: "m", contextWindow: 1000000 },
    thinkingLevel: "off",
  };
  return {
    calls,
    merged,
    deps: {
      getEditor: () => (over.noEditor ? null : (editor as never)),
      getCtx: () => (over.noCtx ? null : (ctx as never)),
      getConfig: () => cfg,
      telemetryTracker: {
        peekLive: () => over.peekLive ?? null,
        getLastTelemetry: () => over.lastTel ?? null,
      } as never,
      runActivityTracker: {
        getSnapshot: () => over.runSnap ?? idleSnap(),
        isRunning: () => over.isRunning ?? false,
      } as never,
      // undefined option → plausible display; explicit null pins the throw/skip branch
      agentLedger: {
        getLiveTotals: () => over.ledgerLive ?? null,
        getIdleAuthoritativeDisplay: () => ("idleDisplay" in over ? over.idleDisplay : tel()),
        getIncrementalLiveDisplayTotals: () => ("incDisplay" in over ? over.incDisplay : tel()),
      } as never,
    },
  };
}

function renderOnce(h: Harness): void {
  // fresh LiveBorder per scenario: lastRenderMs 0 → render() is never throttled
  new LiveBorder(h.deps).render();
}

describe("LiveBorder.render — coalesced draw", () => {
  test("one setChrome per refresh carries every field", () => {
    const h = harness({ peekLive: tel({ totalMs: 5000 }), isRunning: true });
    renderOnce(h);
    assert.equal(h.calls.length, 1, `expected 1 setChrome, got ${h.calls.length}`);
    assert.deepEqual(Object.keys(h.calls[0]!).sort(), [
      "bottomLeftText",
      "telemetryText",
      "topContextText",
      "topRightText",
      "topTokensText",
    ]);
  });

  test("no editor or no ctx → no setChrome at all", () => {
    const noEditor = harness({ noEditor: true });
    renderOnce(noEditor);
    assert.equal(noEditor.calls.length, 0);
    const noCtx = harness({ noCtx: true });
    renderOnce(noCtx);
    assert.equal(noCtx.calls.length, 0);
  });

  test("a throwing ledger island still delivers the other islands' fields in the one patch", () => {
    // idleDisplay null makes formatTelemetryTokens(undefined) throw inside the context
    // island — same as before coalescing, top/telemetry fields still land.
    const h = harness({ idleDisplay: null });
    renderOnce(h);
    assert.equal(h.calls.length, 1);
    assert.ok("topRightText" in h.merged);
    assert.ok(!("topContextText" in h.merged), "context island threw → field not patched");
  });
});

describe("LiveBorder.render — field branches", () => {
  test("telemetry disabled clears bottom, keeps context", () => {
    const h = harness({ config: (c) => void (c.telemetry.enabled = false) });
    renderOnce(h);
    assert.equal(h.calls.length, 1);
    assert.equal(h.merged.telemetryText, "");
    assert.equal(h.merged.bottomLeftText, "");
    assert.equal(h.merged.topTokensText, "");
    assert.ok(h.merged.topContextText!.includes("50.0%"));
  });

  test("no live and no last telemetry → bottom fields untouched", () => {
    const h = harness();
    renderOnce(h);
    assert.equal(h.calls.length, 1);
    assert.ok(!("telemetryText" in h.merged));
    assert.ok(!("bottomLeftText" in h.merged));
  });

  test("live with totalMs 0 suppresses bottom telemetry", () => {
    const h = harness({ peekLive: tel({ totalMs: 0 }) });
    renderOnce(h);
    assert.ok(!("telemetryText" in h.merged));
  });

  test("bottom telemetry carries TPS/TTFT bytes", () => {
    const h = harness({ peekLive: tel({ totalMs: 5000 }), isRunning: true });
    renderOnce(h);
    const plain = stripAnsi(h.merged.telemetryText!);
    assert.ok(plain.includes("tok/s TPS"));
    assert.ok(plain.includes("TTFT"));
  });

  test("stall joins the top-right with a dim pipe when stalls on", () => {
    const h = harness({
      ledgerLive: tel({ stallMs: 1500, stallCount: 2 }),
      runSnap: idleSnap({ phase: "running", turnNumber: 2, durationMs: 12345 }),
    });
    renderOnce(h);
    const plain = stripAnsi(h.merged.topRightText!);
    assert.ok(plain.includes("2 turns"), plain);
    assert.ok(plain.includes(" | !2×1.5s"), plain);
  });

  test("stall suppressed when telemetry.stalls off, still bottom-clean", () => {
    const h = harness({
      config: (c) => void (c.telemetry.stalls = false),
      ledgerLive: tel({ stallMs: 1500, stallCount: 2 }),
    });
    renderOnce(h);
    assert.ok(!stripAnsi(h.merged.topRightText!).includes("1.5s"));
  });

  test("context segment off → empty topContextText", () => {
    const h = harness({ config: (c) => void (c.footerSegments.context = false) });
    renderOnce(h);
    assert.equal(h.merged.topContextText, "");
  });

  test("icon bar off by default, on when contextIconBar true", () => {
    const off = harness();
    renderOnce(off);
    assert.ok(!stripAnsi(off.merged.topContextText!).includes("["));
    const on = harness({ config: (c) => void (c.contextIconBar = true) });
    renderOnce(on);
    assert.ok(stripAnsi(on.merged.topContextText!).includes("[#####-----]"));
  });

  test("idle tokens use the authoritative ledger display (no ~)", () => {
    const h = harness({ idleDisplay: tel({ inputTokens: 3000, outputTokens: 400 }) });
    renderOnce(h);
    const plain = stripAnsi(h.merged.topTokensText!);
    assert.ok(plain.includes("↑ 3.0k") && plain.includes("↓ 400"), plain);
    assert.ok(!plain.includes("~"));
  });

  test("running tokens use the incremental display (~ estimated)", () => {
    const h = harness({
      isRunning: true,
      incDisplay: tel({ inputTokens: 111, outputTokens: 222, estimated: true }),
    });
    renderOnce(h);
    const plain = stripAnsi(h.merged.topTokensText!);
    assert.ok(plain.includes("↑~111") || plain.includes("↑ ~"), plain);
  });
});
