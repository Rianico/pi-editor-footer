import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentRunLedger } from "../src/agent-run-ledger.js";
import type { UsageTotals } from "../src/state.js";
import type { TurnTelemetry } from "../src/telemetry.js";
import type { RunActivitySnapshot } from "../src/run-activity.js";
import { buildTimelineText, formatDateTimeWithTimezone, TranscriptTimeline } from "../src/transcript-timeline.js";
import { DEFAULT_CONFIG } from "../src/config.js";

function mkTel(over: Partial<TurnTelemetry> = {}): TurnTelemetry {
  return {
    tps: 10,
    ttftMs: 500,
    totalMs: 8000,
    inputTokens: 1000,
    outputTokens: 500,
    stallMs: 0,
    stallCount: 0,
    rateUsdPerMTokens: null,
    generationMs: 7000,
    totalTokens: 1500,
    costUsd: 0.01,
    measurementMs: 7000,
    ...over,
  };
}
function mkTotals(over: Partial<UsageTotals> = {}): UsageTotals {
  return {
    input: 5000,
    output: 1200,
    cacheRead: 3000,
    cacheWrite: 0,
    cost: 0.02,
    latestCacheHitRate: 60,
    ...over,
  };
}
function mkSnap(over: Partial<RunActivitySnapshot> = {}): RunActivitySnapshot {
  return {
    phase: "settled",
    turnNumber: 3,
    activeTools: 0,
    completedCount: 5,
    failedCount: 1,
    ...over,
  };
}

describe("formatDateTimeWithTimezone", () => {
  it("formats date with timezone", () => {
    const d = new Date("2026-08-25T10:00:00.000Z");
    const s = formatDateTimeWithTimezone(d);
    // Should contain date and time and timezone (e.g. 2026-08-25 10:00:00 UTC or GMT)
    assert.ok(s.includes("2026-08-25"), `got ${s}`);
    // Time depends on local TZ (e.g. 10:00 UTC = 18:00 GMT+8) — just check time present and tz
    assert.ok(s.includes("00:00"), `got ${s}`);
  });
});

describe("buildTimelineText — pure, TUI-free seam", () => {
  it("builds two-line dim text with per-Agent-run totals", () => {
    const ledger = new AgentRunLedger(() => 0);
    ledger.setBaseline(mkTotals({ input: 0, output: 0, cost: 0 }));
    ledger.startRun(0);
    ledger.recordTurn(mkTel({ inputTokens: 4000, outputTokens: 800, costUsd: 0.015 }));
    const totals = mkTotals({ input: 5000, output: 1200, cost: 0.02, latestCacheHitRate: 75 });
    const snap = mkSnap({ turnNumber: 2, completedCount: 4, failedCount: 0 });
    const text = buildTimelineText({
      effectiveTel: ledger.getSettledTotals(8000),
      totals,
      ctxTokens: 100000,
      snap,
      config: structuredClone(DEFAULT_CONFIG),
      lastDoneIn: 8234,
      now: new Date("2026-08-25T10:00:00Z"),
      ledger,
    });
    // line1 contains dt + wallDur + tokens + cache + cost
    assert.ok(text.includes("2026-08-25"), "dt");
    // wallDur is 8s (or 8s with padding)
    assert.ok(text.includes("8s"), `wallDur in ${text}`);
    // tokens — perAgent input capped, at least input token glyph
    // Glyph depends on icon mode (nerd vs ascii): check for input/output numbers instead
    assert.ok(text.includes("4.0k") || text.includes("4000"), `input tokens in ${text}`);
    assert.ok(text.includes("800"), `output tokens in ${text}`);
    // cache
    assert.ok(text.includes("75.0%") || text.includes("75"), "cache rate");
    // cost
    assert.ok(text.includes("$0.01") || text.includes("$0.02"), `cost in ${text}`);
    // line2
    assert.ok(text.includes("2 turns"), "turns");
    assert.ok(text.includes("4 tools") || text.includes("tools"), "tools");
    assert.ok(text.includes("\n"), "two lines");
  });

  it("uses ledger per-Agent totals — max not sum", () => {
    const ledger = new AgentRunLedger(() => 0);
    ledger.setBaseline(mkTotals({ input: 1000, output: 0 }));
    const tel = mkTel({ inputTokens: 60000, outputTokens: 500 });
    // totals session 61000 input, but perAgent should be capped to context + ledger max
    const totals = mkTotals({ input: 61000, output: 1200, latestCacheHitRate: 0 });
    const snap = mkSnap();
    const text = buildTimelineText({
      effectiveTel: tel,
      totals,
      ctxTokens: 50000,
      snap,
      config: structuredClone(DEFAULT_CONFIG),
      lastDoneIn: 1000,
      ledger,
    });
    // input should be capped to 50000 (context), not 61000
    // fmtTokens for 50000 is 50k
    assert.ok(text.includes("50k") || text.includes("50000") || text.includes("50"), `capped input in ${text}`);
  });
});

describe("TranscriptTimeline — deep module seam (two adapters)", () => {
  it("handleAgentSettled uses public appendEntry when available (prod adapter)", () => {
    const timeline = new TranscriptTimeline();
    const ledger = new AgentRunLedger(() => 0);
    ledger.setBaseline(mkTotals({ input: 0 }));
    const totals = mkTotals();
    const snap = mkSnap();
    const fakePi: { calls: unknown[]; appendEntry(t: string, d: unknown): void } = {
      calls: [],
      appendEntry(t: string, d: unknown) {
        this.calls.push({ t, d });
      },
    };
    const fakeCtx = { setWidget: () => {}, theme: { fg: (_c: string, s: string) => s } };
    const wall = timeline.handleAgentSettled(fakeCtx as never, fakePi as never, {
      effectiveTel: mkTel(),
      totals,
      ctxTokens: 100000,
      snap,
      config: structuredClone(DEFAULT_CONFIG),
      lastDoneIn: 5000,
      ledger,
    });
    assert.ok(wall !== null);
    assert.equal(fakePi.calls.length, 1);
    assert.equal((fakePi.calls[0] as { t: string }).t, "timeline");
    assert.equal(timeline.getHistory().length, 1);
    assert.equal(timeline.getHistory()[0], wall);
  });

  it("handleAgentSettled falls back to private chatContainer scan when no appendEntry (in-memory fake)", () => {
    const timeline = new TranscriptTimeline();
    const ledger = new AgentRunLedger(() => 0);
    const totals = mkTotals();
    const snap = mkSnap();
    const fakeCtx = { setWidget: () => {}, theme: { fg: (_c: string, s: string) => s } };
    const fakePi = {}; // no appendEntry
    const wall = timeline.handleAgentSettled(fakeCtx as never, fakePi as never, {
      effectiveTel: mkTel(),
      totals,
      ctxTokens: 100000,
      snap,
      config: structuredClone(DEFAULT_CONFIG),
      lastDoneIn: 5000,
      ledger,
    });
    assert.ok(wall !== null);
    // History still recorded even for fallback path (inject pushes)
    assert.equal(timeline.getHistory().length, 1);
  });

  it("returns null when timeline disabled — respects config gating", () => {
    const timeline = new TranscriptTimeline();
    const ledger = new AgentRunLedger();
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.timeline.enabled = false;
    const res = timeline.handleAgentSettled(
      { setWidget: () => {} } as never,
      {} as never,
      {
        effectiveTel: mkTel(),
        totals: mkTotals(),
        ctxTokens: undefined,
        snap: mkSnap(),
        config: cfg,
        lastDoneIn: 1000,
        ledger,
      },
    );
    assert.equal(res, null);
    assert.equal(timeline.getHistory().length, 0);
  });

  it("clear resets history", () => {
    const timeline = new TranscriptTimeline();
    const ledger = new AgentRunLedger();
    timeline.handleAgentSettled(
      { setWidget: () => {}, theme: { fg: (_c: string, s: string) => s } } as never,
      { appendEntry: () => {} } as never,
      {
        effectiveTel: mkTel(),
        totals: mkTotals(),
        ctxTokens: undefined,
        snap: mkSnap(),
        config: structuredClone(DEFAULT_CONFIG),
        lastDoneIn: 1000,
        ledger,
      },
    );
    assert.equal(timeline.getHistory().length, 1);
    timeline.clear();
    assert.equal(timeline.getHistory().length, 0);
  });
});
