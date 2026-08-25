import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentRunLedger,
  aggregateAgentTurns,
  capInputForIdle,
  capInputForLive,
  deltaFromBaseline,
} from "../src/agent-run-ledger.js";
import type { UsageTotals } from "../src/state.js";
import type { TurnTelemetry } from "../src/telemetry.js";

function mkTel(over: Partial<TurnTelemetry> = {}): TurnTelemetry {
  return {
    tps: null,
    ttftMs: 100,
    totalMs: 1000,
    inputTokens: 1000,
    outputTokens: 500,
    stallMs: 0,
    stallCount: 0,
    rateUsdPerMTokens: null,
    generationMs: 800,
    totalTokens: 1500,
    costUsd: 0.01,
    measurementMs: 800,
    ...over,
  };
}
function mkTotals(over: Partial<UsageTotals> = {}): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    latestCacheHitRate: undefined,
    ...over,
  };
}

describe("cap helpers", () => {
  it("capInputForIdle caps to context and session total", () => {
    assert.equal(capInputForIdle(60000, 50000, 100000), 50000);
    assert.equal(capInputForIdle(60000, undefined, 100000), 60000);
    assert.equal(capInputForIdle(60000, 50000, 30000), 30000);
    assert.equal(capInputForIdle(0, 50000, 10000), 0);
  });
  it("capInputForLive caps only to context", () => {
    assert.equal(capInputForLive(60000, 50000), 50000);
    assert.equal(capInputForLive(60000, undefined), 60000);
    // live not capped to session total — predictive
    assert.equal(capInputForLive(60000, undefined), 60000);
  });
  it("deltaFromBaseline clamps to zero", () => {
    const cur = mkTotals({ input: 100, output: 50, cost: 1 });
    const base = mkTotals({ input: 90, output: 40, cost: 0.5 });
    assert.deepEqual(deltaFromBaseline(cur, base), {
      input: 10,
      output: 10,
      cost: 0.5,
    });
    const cur2 = mkTotals({ input: 5, output: 5, cost: 0 });
    const base2 = mkTotals({ input: 10, output: 10, cost: 1 });
    assert.deepEqual(deltaFromBaseline(cur2, base2), {
      input: 0,
      output: 0,
      cost: 0,
    });
  });
});

describe("aggregateAgentTurns", () => {
  it("max not sum for input, sum for output/cost", () => {
    const t1 = mkTel({ inputTokens: 50000, outputTokens: 200, costUsd: 0.01 });
    const t2 = mkTel({ inputTokens: 60000, outputTokens: 300, costUsd: 0.02 });
    const agg = aggregateAgentTurns([t1, t2], null, 0, 5000);
    assert.ok(agg);
    // max not sum — 60k not 110k
    assert.equal(agg.inputTokens, 60000);
    assert.equal(agg.outputTokens, 500);
    assert.equal(agg.costUsd, 0.03);
    assert.equal(agg.totalTokens, 60500);
  });
  it("includes live turn with max-vs-sum", () => {
    const t1 = mkTel({ inputTokens: 50000, outputTokens: 200, costUsd: 0.01 });
    const live = mkTel({ inputTokens: 55000, outputTokens: 100, costUsd: 0.005 });
    const agg = aggregateAgentTurns([t1], live, 0, 5000);
    assert.ok(agg);
    assert.equal(agg.inputTokens, 55000);
    assert.equal(agg.outputTokens, 300);
  });
  it("returns null when no agent active and no turns/live", () => {
    assert.equal(aggregateAgentTurns([], null, null, 0), null);
    assert.equal(aggregateAgentTurns([], null, Date.now(), Date.now()), null);
  });
  it("live input 18k not 279k scenario — session delta vs max", () => {
    // Simulate sessionTotals 279k, baseline 0, but per-agent max is 60k live
    // ledger's cap ensures live not exceed context 60k
    const agg = aggregateAgentTurns(
      [mkTel({ inputTokens: 50000, outputTokens: 200 })],
      mkTel({ inputTokens: 60000, outputTokens: 100 }),
      0,
      5000,
    );
    assert.equal(agg?.inputTokens, 60000);
    // capped to context 60000 stays 60000
    assert.equal(capInputForLive(agg!.inputTokens, 60000), 60000);
    // if mistakenly summed 110k, cap would hide but still wrong totalTokens
    assert.notEqual(agg?.inputTokens, 110000);
  });
});

describe("AgentRunLedger", () => {
  it("tracks baseline and startRun", () => {
    const ledger = new AgentRunLedger(() => 0);
    const base = mkTotals({ input: 1000, output: 500, cost: 0.1 });
    ledger.setBaseline(base);
    ledger.startRun(0);
    assert.deepEqual(ledger.getBaseline(), base);
    assert.equal(ledger.isActive(), true);
    assert.equal(ledger.getTurnCount(), 0);
  });
  it("recordTurn and getSettledTotals uses max-vs-sum", () => {
    const ledger = new AgentRunLedger(() => 5000);
    ledger.startRun(0);
    ledger.recordTurn(mkTel({ inputTokens: 50000, outputTokens: 200 }));
    ledger.recordTurn(mkTel({ inputTokens: 60000, outputTokens: 300 }));
    const settled = ledger.getSettledTotals(5000);
    assert.ok(settled);
    assert.equal(settled.inputTokens, 60000);
    assert.equal(settled.outputTokens, 500);
  });
  it("getPerAgentTotalsForTimeline prefers tel capped to idle", () => {
    const ledger = new AgentRunLedger();
    ledger.setBaseline(mkTotals({ input: 100000, output: 100 }));
    const tel = mkTel({ inputTokens: 60000, outputTokens: 400, costUsd: 0.02 });
    const snap = mkTotals({ input: 160000, output: 500, cost: 0.03 });
    const res = ledger.getPerAgentTotalsForTimeline(tel, snap, 60000);
    assert.equal(res.input, 60000); // capped to context
    assert.equal(res.output, 400);
  });
  it("timeline falls back to baseline delta capped", () => {
    const ledger = new AgentRunLedger();
    ledger.setBaseline(mkTotals({ input: 100000, output: 100, cost: 0.01 }));
    const snap = mkTotals({ input: 160000, output: 500, cost: 0.03 });
    // 60k delta, context 50000 -> capped to 50000
    const res = ledger.getPerAgentTotalsForTimeline(null, snap, 50000);
    assert.equal(res.input, 50000);
    assert.equal(res.output, 400);
  });
  it("timeline falls back to session totals when no baseline", () => {
    const ledger = new AgentRunLedger();
    const snap = mkTotals({ input: 5000, output: 200, cost: 0.01 });
    const res = ledger.getPerAgentTotalsForTimeline(null, snap, 10000);
    assert.equal(res.input, 5000);
  });
  it("getIdleDisplayTotals prefers liveAgent capped to idle", () => {
    const ledger = new AgentRunLedger();
    ledger.setBaseline(mkTotals({ input: 1000, output: 0, cost: 0 }));
    const snap = mkTotals({ input: 61000, output: 1000, cost: 0.02 });
    const liveAgent = mkTel({ inputTokens: 60000, outputTokens: 500 });
    const display = ledger.getIdleDisplayTotals(snap, 60000, liveAgent);
    assert.equal(display.inputTokens, 60000);
    assert.equal(display.outputTokens, 500);
  });
  it("getIdleDisplayTotals falls back to baseline delta when no liveAgent", () => {
    const ledger = new AgentRunLedger();
    ledger.setBaseline(mkTotals({ input: 1000, output: 0, cost: 0 }));
    const snap = mkTotals({ input: 61000, output: 1000, cost: 0.02 });
    const display = ledger.getIdleDisplayTotals(snap, 70000, null);
    // delta = 60000, capped to sessionTotal 61000 and context 70000 -> 60000
    assert.equal(display.inputTokens, 60000);
  });
  it("getLiveDisplayTotals uses liveTurn window and caps to live only", () => {
    const ledger = new AgentRunLedger();
    const agentLive = mkTel({ inputTokens: 50000, outputTokens: 300 });
    const liveTurn = mkTel({ inputTokens: 60000, outputTokens: 100 });
    const display = ledger.getLiveDisplayTotals(liveTurn, agentLive, 60000);
    assert.ok(display);
    assert.equal(display.inputTokens, 60000); // liveTurn window replaces agentLive input
    assert.equal(display.outputTokens, 300); // agentLive already includes live output via peekAgentLive
    // capped to context 60000
    assert.equal(capInputForLive(display.inputTokens, 60000), 60000);
    // not capped to session total — even if session total is 50000 interim, live still 60000
    const display2 = ledger.getLiveDisplayTotals(liveTurn, agentLive, 60000);
    assert.equal(display2?.inputTokens, 60000);
  });
  it("live caps only to context, not session total", () => {
    // simulate predictive live 60k while authoritative totals interim 50k
    const ledger = new AgentRunLedger();
    const agentLive = mkTel({ inputTokens: 50000, outputTokens: 200 });
    const liveTurn = mkTel({ inputTokens: 60000, outputTokens: 100 });
    const display = ledger.getLiveDisplayTotals(liveTurn, agentLive, 60000);
    // should be 60k even if session total were 50000 (not passed for live cap)
    assert.equal(display?.inputTokens, 60000);
  });
  it("reset clears state", () => {
    const ledger = new AgentRunLedger(() => 0);
    ledger.setBaseline(mkTotals({ input: 1 }));
    ledger.startRun(0);
    ledger.recordTurn(mkTel());
    ledger.reset();
    assert.equal(ledger.getBaseline(), null);
    assert.equal(ledger.isActive(), false);
    assert.equal(ledger.getTurnCount(), 0);
  });
  it("immutable baseline clone", () => {
    const ledger = new AgentRunLedger();
    const base = mkTotals({ input: 100 });
    ledger.setBaseline(base);
    base.input = 999;
    assert.equal(ledger.getBaseline()?.input, 100);
  });
});
