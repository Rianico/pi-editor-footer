/**
 * AgentRunLedger — deep module owning per-Agent-run accounting behind one seam.
 *
 * Domain: Agent run = agent_start → agent_settled, containing one or more Turns
 * (CONTEXT.md). Per-agent totals must use max(input) not sum(input) — each Turn's
 * input is the full prompt (includes history), so summing double-counts overlapping
 * history (e.g. 50k+60k=110k > window 60k). Output/cost do sum. Live input is window
 * occupancy, capped to contextWindow and session totals.
 *
 * Previously this logic was scattered across 3 call sites (telemetry.peekAgentLive
 * max-vs-sum, live-border.refreshContextBar 70L capping, index.agent_settled 60L
 * baseline fallback) with divergent caps. Bugs required holding 3 sites in one head.
 *
 * Depth: small interface (setBaseline / startRun / recordTurn / getTotals / getLive
 * / cap helpers) hides baseline delta, max-vs-sum, predictive vs authoritative capping,
 * and tps derivation. Two adapters (LiveBorder token bar, index timeline) justify the seam.
 * Internal seams (aggregateTurns, capIdle, capLive) stay private.
 */

import type { UsageTotals } from "./state.js";
import type { TurnTelemetry } from "./telemetry.js";

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Pure aggregation: max(input) + sum(output/cost/stalls) across turns, plus optional live turn.
 * Shared by TurnTelemetryTracker.peekAgentLive / endAgent and ledger — single source for
 * the "max not sum" invariant.
 */
export function aggregateAgentTurns(
  turns: TurnTelemetry[],
  live: TurnTelemetry | null,
  startMs: number | null,
  now: number,
): TurnTelemetry | null {
  const hasCompleted = turns.length > 0;
  if (startMs === null) {
    // No agent active — caller should handle fallback to lastTelemetry/live
    if (!hasCompleted && !live) return null;
    // still produce cumulative if we have turns/live but no startMs (defensive)
  } else if (!hasCompleted && !live) {
    return null;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let stallMs = 0;
  let stallCount = 0;
  let generationMs = 0;
  let ttftMs = 0;
  for (const t of turns) {
    inputTokens = Math.max(inputTokens, t.inputTokens);
    outputTokens += t.outputTokens;
    costUsd += t.costUsd;
    stallMs += t.stallMs;
    stallCount += t.stallCount;
    generationMs += t.generationMs;
  }
  if (turns.length > 0) ttftMs = turns[0]!.ttftMs;
  if (live) {
    inputTokens = Math.max(inputTokens, live.inputTokens);
    outputTokens += live.outputTokens;
    costUsd += live.costUsd;
    stallMs += live.stallMs;
    stallCount += live.stallCount;
    generationMs += live.generationMs;
    if (ttftMs === 0) ttftMs = live.ttftMs;
  }
  totalTokens = inputTokens + outputTokens;
  const totalMs = startMs !== null ? Math.max(0, now - startMs) : 0;
  const measurementMs =
    outputTokens > 0 && generationMs > 0 ? generationMs : null;
  const tps =
    measurementMs === null
      ? null
      : round(outputTokens / (measurementMs / 1000), 1);
  const validCost = Number.isFinite(costUsd) && costUsd > 0;
  const validTokens = Number.isFinite(totalTokens) && totalTokens > 0;
  return {
    tps,
    ttftMs,
    totalMs,
    inputTokens,
    outputTokens,
    stallMs,
    stallCount,
    rateUsdPerMTokens:
      validCost && validTokens
        ? round(costUsd / (totalTokens / 1_000_000), 2)
        : null,
    generationMs,
    totalTokens,
    costUsd: validCost ? costUsd : 0,
    measurementMs,
  };
}

/**
 * Capping helpers — single source for "live input 18k not 279k" invariant.
 * Idle (settled) input is authoritative, capped to both context window and session total.
 * Live (running) input is predictive, capped only to context window (not totals) — totals
 * lag behind liveTurn, capping to totals would make live stale (50k) during second turn
 * streaming instead of showing current window 60k.
 */
export function capInputForIdle(
  input: number,
  contextTokens: number | undefined,
  sessionTotalInput: number,
): number {
  let capped = input;
  if (
    typeof contextTokens === "number" &&
    Number.isFinite(contextTokens) &&
    contextTokens > 0
  ) {
    capped = Math.min(capped, contextTokens);
  }
  if (sessionTotalInput > 0) {
    capped = Math.min(capped, sessionTotalInput);
  }
  return Math.max(0, capped);
}

export function capInputForLive(
  input: number,
  contextTokens: number | undefined,
): number {
  let capped = input;
  if (
    typeof contextTokens === "number" &&
    Number.isFinite(contextTokens) &&
    contextTokens > 0
  ) {
    capped = Math.min(capped, contextTokens);
  }
  return Math.max(0, capped);
}

/** Delta from baseline totals (session delta), used when telemetry not available. */
export function deltaFromBaseline(
  cur: UsageTotals,
  base: UsageTotals,
): { input: number; output: number; cost: number } {
  return {
    input: Math.max(0, cur.input - base.input),
    output: Math.max(0, cur.output - base.output),
    cost: Math.max(0, cur.cost - base.cost),
  };
}

export class AgentRunLedger {
  private baseline: UsageTotals | null = null;
  private turns: TurnTelemetry[] = [];
  private startMs: number | null = null;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Capture baseline at agent_start. Clone to avoid caller mutation. */
  setBaseline(baseline: UsageTotals | null): void {
    this.baseline = baseline ? { ...baseline } : null;
  }

  getBaseline(): UsageTotals | null {
    return this.baseline ? { ...this.baseline } : null;
  }

  startRun(startMs?: number): void {
    this.startMs = typeof startMs === "number" ? startMs : this.now();
    this.turns = [];
  }

  /** Record a completed turn's telemetry (called by telemetryTracker or directly). */
  recordTurn(turn: TurnTelemetry): void {
    this.turns.push({ ...turn });
  }

  /** Settled totals without live turn — used at agent_settled for timeline. */
  getSettledTotals(now?: number): TurnTelemetry | null {
    const n = typeof now === "number" ? now : this.now();
    return aggregateAgentTurns(this.turns, null, this.startMs, n);
  }

  /** Live totals including optional running turn. */
  getLiveTotals(
    liveTurn: TurnTelemetry | null,
    now?: number,
  ): TurnTelemetry | null {
    const n = typeof now === "number" ? now : this.now();
    const result = aggregateAgentTurns(
      this.turns,
      liveTurn,
      this.startMs,
      n,
    );
    // If no agent active (startMs null) but we have turns/live, aggregateTurns handles it;
    // otherwise fallback to null.
    return result;
  }

  /**
   * Timeline/display totals at agent_settled.
   * Prefers authoritative telemetry (tel) when available; otherwise falls back to
   * baseline delta; otherwise session totals. Caps idle input to context + session total.
   * This is the single place that knows the "prefer tel, else delta capped" policy.
   */
  getPerAgentTotalsForTimeline(
    tel: TurnTelemetry | null | undefined,
    snapshotTotals: UsageTotals,
    contextTokens: number | undefined,
  ): { input: number; output: number; cost: number } {
    if (tel) {
      const cappedInput = capInputForIdle(
        tel.inputTokens,
        contextTokens,
        snapshotTotals.input,
      );
      return {
        input: cappedInput,
        output: tel.outputTokens,
        cost: tel.costUsd,
      };
    }
    if (this.baseline) {
      const d = deltaFromBaseline(snapshotTotals, this.baseline);
      const cappedInput = capInputForIdle(
        d.input,
        contextTokens,
        snapshotTotals.input,
      );
      return { input: cappedInput, output: d.output, cost: d.cost };
    }
    // No baseline — best effort session totals capped for input
    const cappedInput = capInputForIdle(
      snapshotTotals.input,
      contextTokens,
      snapshotTotals.input,
    );
    return {
      input: cappedInput,
      output: snapshotTotals.output,
      cost: snapshotTotals.cost,
    };
  }

  /**
   * Idle display totals for LiveBorder when not running.
   * Prefers liveAgent/liveTelemetry when available; else baseline delta, capped to idle.
   */
  getIdleDisplayTotals(
    snapshotTotals: UsageTotals,
    contextTokens: number | undefined,
    liveAgent: TurnTelemetry | null,
  ): TurnTelemetry {
    let displayInput: number;
    let displayOutput: number;
    let displayCost: number;
    if (liveAgent) {
      displayInput = liveAgent.inputTokens;
      displayOutput = liveAgent.outputTokens;
      displayCost = liveAgent.costUsd;
    } else if (this.baseline) {
      const d = deltaFromBaseline(snapshotTotals, this.baseline);
      displayInput = d.input;
      displayOutput = d.output;
      displayCost = d.cost;
    } else {
      displayInput = snapshotTotals.input;
      displayOutput = snapshotTotals.output;
      displayCost = snapshotTotals.cost;
    }
    const cappedInput = capInputForIdle(
      displayInput,
      contextTokens,
      snapshotTotals.input,
    );
    return {
      tps: null,
      ttftMs: 0,
      totalMs: 0,
      inputTokens: cappedInput,
      outputTokens: displayOutput,
      stallMs: 0,
      stallCount: 0,
      rateUsdPerMTokens: null,
      generationMs: 0,
      totalTokens: cappedInput + displayOutput,
      costUsd: displayCost,
      measurementMs: null,
    };
  }

  /**
   * Live display totals when running: liveTurn input (current window) replaces
   * agentLive input, output/cost remain per-agent sum, capped to live context only.
   */
  getLiveDisplayTotals(
    liveTurn: TurnTelemetry | null,
    agentLive: TurnTelemetry | null,
    contextTokens: number | undefined,
  ): TurnTelemetry | null {
    if (!agentLive && !liveTurn) return null;
    let displayLive: TurnTelemetry | null = agentLive;
    if (agentLive && liveTurn) {
      displayLive = {
        ...agentLive,
        inputTokens: liveTurn.inputTokens,
        totalTokens: liveTurn.inputTokens + agentLive.outputTokens,
      };
    } else if (!agentLive && liveTurn) {
      // Edge: no agent yet but liveTurn exists — use liveTurn window
      displayLive = liveTurn;
    }
    if (!displayLive) return null;
    const cappedInput = capInputForLive(
      displayLive.inputTokens,
      contextTokens,
    );
    return {
      ...displayLive,
      inputTokens: cappedInput,
      totalTokens: cappedInput + displayLive.outputTokens,
    };
  }

  reset(): void {
    this.baseline = null;
    this.turns = [];
    this.startMs = null;
  }

  isActive(): boolean {
    return this.startMs !== null;
  }

  getTurnCount(): number {
    return this.turns.length;
  }
}
