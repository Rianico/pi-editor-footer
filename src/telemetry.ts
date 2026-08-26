/**
 * Turn telemetry tracker — pure, TUI-free. Turn-scoped only.
 *
 * Rebuilt bespoke from tmp/pi-open-tui/extensions/open-tui/telemetry.ts.
 * No imports beyond stdlib and pi-tui width utils omitted here (pure maths).
 *
 * Agent-run lifecycle is owned by AgentRunLedger (agent-run-ledger.ts) —
 * this tracker deliberately has NO agent window (no agentStartMs/agentTurns/
 * peekAgentLive). Agent events are accepted as no-ops for event-shape compat.
 *
 * TPS model — absorbed from @arhen/pi-core-tps-stats (MIT):
 *   https://github.com/arhen/pi-extensions/tree/main/packages/core/pi-core-tps-stats
 *
 *   One rate, deliberately: all output tokens (thinking + text + tool-call
 *   args) / whole turn, prefill + queue included. It reads lower than a
 *   provider's marketing number because it is the rate you actually wait for.
 *
 *   Earlier window-based math (output / (lastChunk-firstChunk)) does not
 *   survive contact with real providers. SSE arrival times measure the
 *   gateway's flush schedule, not generation speed — median inter-chunk gap
 *   on vantis/deepseek-v4-flash is 0.01ms (instant batches, long pauses), so
 *   the "window" is an artifact of batch boundaries:
 *
 *       prompt              turn      window-based    this tracker (whole turn)
 *       "Say OK."           1.40s        263 t/s          41 t/s
 *       "List 3 fruits."    8.81s        801 t/s          14 t/s
 *       900-word essay     18.49s         89 t/s          55 t/s
 *
 *   Window spread 9× on one model in one minute; whole-turn stays in a
 *   plausible band. We therefore derive TPS from whole-turn elapsed
 *   (now - turnStart), never from the streaming window (now - firstToken)
 *   — live and final share the same denominator. TTFT remains a direct
 *   observation (firstToken - turnStart).
 *
 * Live input/output — estimation vs authoritative:
 *   - input: known at turn_start via getContextUsage().tokens (window
 *     occupancy). Stored as liveInputTokens and capped by AgentRunLedger
 *     (max-vs-sum + contextWindow cap) — see agent-run-ledger.ts.
 *   - output: no usage before message_end, so we estimate O(1) per delta:
 *     liveDeltaChars += delta.length, liveEstimatedTokens = ceil(chars/4)
 *     monotonic max. ~4 chars/token is English; ~2-3 Chinese, ~3.5 code.
 *     Approximately accurate at 1 s display granularity; final
 *     message.usage.output corrects the estimate on message_end/turn_end.
 *     External tiktoken sampled throttled (every 200 ms) would be 10-100×
 *     more CPU and defeat throttling — not used; final corrects.
 *   - TPS: live = estimate / wholeTurnElapsed (stable), final = usage.output
 *     / wholeTurnElapsed (authoritative). Both include TTFT/queue/prefill.
 */

const STALL_THRESHOLD_MS = 1000;

// ── pure helpers — exported for tests / parity with pi-core-tps-stats ──

/** bounded ring: keep newest MAX_SAMPLES values (reference: 200). */
export const MAX_SAMPLES = 200;

export function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Totoken-per-second over the whole turn — the only TPS we report.
 * Deliberately uses whole-turn duration so gateway batching does not inflate it.
 * Mirrors pi-core-tps-stats tps() exactly.
 */
export function tps(
  outputTokens: number,
  turnStartMs: number,
  endMs: number,
): number | undefined {
  const durationMs = endMs - turnStartMs;
  if (outputTokens <= 0 || durationMs <= 0) return undefined;
  return outputTokens / (durationMs / 1000);
}

/** Duration formatter matching pi-core-tps-stats fmtDur: 6,9s / 10s / 1m 5s */
export function fmtDur(ms: number): string {
  if (ms < 10000) return `${(ms / 1000).toFixed(1).replace(".", ",")}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** first streamed token — any content kind counts as generated tokens. */
const CONTENT_START_EVENTS = new Set([
  "text_start",
  "thinking_start",
  "toolcall_start",
]);

/** streaming delta variants — where live output estimation happens. */
const CONTENT_DELTA_EVENTS = new Set([
  "text_delta",
  "thinking_delta",
  "toolcall_delta",
]);

export interface TurnTelemetry {
  tps: number | null;
  ttftMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  stallMs: number;
  stallCount: number;
  rateUsdPerMTokens: number | null;
  generationMs: number;
  totalTokens: number;
  costUsd: number;
  measurementMs: number | null;
  /** true when outputTokens includes live estimate (chars/4) not yet authoritative usage */
  estimated?: boolean;
}

export interface TelemetryConfig {
  enabled: boolean;
  tps: boolean;
  ttft: boolean;
  duration: boolean;
  tokens: boolean;
  stalls: boolean;
  cost: boolean;
}

export type AssistantMessage = {
  role: "assistant";
  content: unknown;
  api?: string;
  provider?: string;
  model?: string;
  usage: {
    input: number;
    output: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cacheRead?: number;
    cacheWrite?: number;
  };
  stopReason?: string;
  timestamp?: number;
};

type AgentMessage = { role: string } & AssistantMessage;

export type TelemetryEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "agent_settled" }
  | {
      type: "turn_start";
      turnIndex?: number;
      timestamp?: number;
      inputTokens?: number;
    }
  | { type: "message_start"; message: AgentMessage }
  | {
      type: "message_update";
      message: AgentMessage;
      assistantMessageEvent: {
        type: string;
        delta: string;
        contentIndex?: number;
        partial?: unknown;
      };
    }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; [key: string]: unknown }
  | {
      type: "turn_end";
      turnIndex?: number;
      message?: AgentMessage;
      toolResults?: unknown[];
    };
interface MessageTiming {
  lastUpdateMs: number;
  firstOutputMs: number | null;
  inStall: boolean;
}

interface TurnTiming {
  startMs: number;
  firstTokenMs: number | null;
  currentMessage: MessageTiming | null;
  messages: AssistantMessage[];
  generationMs: number;
  stallMs: number;
  stallCount: number;
  liveEstimatedTokens: number;
  liveDeltaChars: number;
  liveInputTokens: number | null;
}

function isAssistantMessage(message: AgentMessage): boolean {
  return message.role === "assistant";
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    // fixed width 7, e.g. "     8s" / "    59s"
    return `${String(totalSeconds).padStart(2, " ")}s`.padStart(7, " ");
  }
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    // 59m 59s -> 7 chars, e.g. " 5m 03s" / "59m 59s"
    const mStr = String(totalMinutes).padStart(2, " ");
    const sStr = String(s).padStart(2, "0");
    return `${mStr}m ${sStr}s`;
  }
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  // 24h 21m -> 7 chars, no seconds, no days
  const hStr = String(Math.min(h, 99)).padStart(2, " ");
  const mStr = String(m).padStart(2, "0");
  return `${hStr}h ${mStr}m`;
}

export class TurnTelemetryTracker {
  private readonly now: () => number;
  private turn: TurnTiming | undefined;
  private lastTelemetry: TurnTelemetry | null = null;
  private lastTurnTelemetry: TurnTelemetry | null = null;
  private decayBaseTps: number | null = null;
  private decayStartMs: number | null = null;
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  getLastTelemetry(): TurnTelemetry | null {
    return this.lastTelemetry;
  }

  getLastTurnTelemetry(): TurnTelemetry | null {
    return this.lastTurnTelemetry;
  }

  /** Reset live + last telemetry — call on model change (pi-core-tps-stats resets on model_select). */
  reset(): void {
    this.turn = undefined;
    this.lastTelemetry = null;
    this.lastTurnTelemetry = null;
    this.decayBaseTps = null;
    this.decayStartMs = null;
  }

  /**
   * Live snapshot while a turn is running — for real-time border refresh.
   * Returns null when idle.
   * TPS uses whole-turn elapsed (now - turnStart), matching final tps() and
   * pi-core-tps-stats, so live does not inflate via gateway batching.
   */
  peekLive(): TurnTelemetry | null {
    const turn = this.turn;
    if (!turn) return null;
    const now = this.now();
    const elapsed = Math.max(0, now - turn.startMs);
    // before first token — decay previous TPS gradually instead of jumping to —
    if (turn.firstTokenMs === null) {
      let decayedTps: number | null = null;
      if (this.decayBaseTps !== null && this.decayStartMs !== null) {
        const elapsedSinceDecay = Math.max(0, now - this.decayStartMs);
        // Reset to default after 2s without incoming tokens per user request
        if (elapsedSinceDecay >= 2000) {
          decayedTps = null;
        } else {
          // exponential decay, half-life ~5s (exp(-elapsed/7200) => half at ~5s ln2*7200≈5000)
          const decayed =
            this.decayBaseTps * Math.exp(-elapsedSinceDecay / 7200);
          if (decayed >= 0.05) decayedTps = round(decayed, 1);
        }
      }
      const liveInput = turn.liveInputTokens ?? 0;
      return {
        tps: decayedTps,
        ttftMs: 0,
        totalMs: elapsed,
        inputTokens: liveInput,
        outputTokens: 0,
        stallMs: turn.stallMs,
        stallCount: turn.stallCount,
        rateUsdPerMTokens: null,
        generationMs: elapsed,
        totalTokens: liveInput,
        costUsd: 0,
        measurementMs: null,
        estimated: true,
      };
    }
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;
    for (const m of turn.messages) {
      inputTokens += m.usage.input;
      outputTokens += m.usage.output;
      totalTokens += m.usage.totalTokens;
      costUsd += m.usage.cost.total;
    }
    // Input is known at turn_start — use live estimate before authoritative usage arrives
    if (
      inputTokens === 0 &&
      turn.liveInputTokens !== null &&
      turn.liveInputTokens > 0
    ) {
      inputTokens = turn.liveInputTokens;
      totalTokens = Math.max(totalTokens, inputTokens + outputTokens);
    }
    // During streaming no message has ended yet — use live estimate so border refreshes in real time.
    // Corrected to authoritative usage on message_end/turn_end.
    if (outputTokens === 0 && turn.liveEstimatedTokens > 0) {
      outputTokens = turn.liveEstimatedTokens;
      totalTokens = Math.max(totalTokens, inputTokens + outputTokens);
    } else if (turn.liveEstimatedTokens > outputTokens) {
      // streaming extension of current message — reflect growth even before message_end
      outputTokens = turn.liveEstimatedTokens;
      totalTokens = Math.max(totalTokens, inputTokens + outputTokens);
    }
    // Whole-turn TPS — stable, includes TTFT/prefill/queue (see header). Guard tiny elapsed to avoid spike.
    const measurementMs = elapsed >= 500 && outputTokens > 0 ? elapsed : null;
    const tpsVal =
      measurementMs === null
        ? null
        : round(outputTokens / (measurementMs / 1000), 1);
    // Also expose pure tps() parity check (unused here, tested separately): tps(outputTokens, turn.startMs, now)
    void tps;
    const validCost = Number.isFinite(costUsd) && costUsd > 0;
    const validTokens = Number.isFinite(totalTokens) && totalTokens > 0;
    return {
      tps: tpsVal,
      ttftMs: turn.firstTokenMs - turn.startMs,
      totalMs: elapsed,
      inputTokens,
      outputTokens,
      stallMs: turn.stallMs,
      stallCount: turn.stallCount,
      rateUsdPerMTokens:
        validCost && validTokens
          ? round(costUsd / (totalTokens / 1_000_000), 2)
          : null,
      generationMs: elapsed,
      totalTokens,
      costUsd: validCost ? costUsd : 0,
      measurementMs,
      estimated: true,
    };
  }

  handle(event: TelemetryEvent): TurnTelemetry | undefined {
    switch (event.type) {
      // Agent lifecycle is owned by AgentRunLedger — this tracker is turn-scoped.
      // Accepted as no-ops so index.ts can keep a uniform handle() call shape.
      case "agent_start":
      case "agent_end":
      case "agent_settled":
        return;
      case "turn_start":
        this.startTurn((event as { inputTokens?: number }).inputTokens);
        return;
      case "message_start":
        this.startMessage(event.message);
        return;
      case "message_update":
        this.updateMessage(
          event as {
            type: "message_update";
            message: AgentMessage;
            assistantMessageEvent: { type: string; delta: string };
          },
        );
        return;
      case "message_end":
        this.endMessage(event.message);
        return;
      case "tool_execution_start":
        return;
      case "turn_end":
        return this.endTurnAndCollect();
    }
  }

  private startTurn(inputTokens?: number): void {
    // seed decay from last turn's TPS
    this.decayBaseTps = this.lastTelemetry?.tps ?? null;
    this.decayStartMs = this.now();
    this.turn = {
      startMs: this.now(),
      firstTokenMs: null,
      currentMessage: null,
      messages: [],
      generationMs: 0,
      stallMs: 0,
      stallCount: 0,
      liveEstimatedTokens: 0,
      liveDeltaChars: 0,
      liveInputTokens:
        typeof inputTokens === "number" && Number.isFinite(inputTokens)
          ? inputTokens
          : null,
    };
  }
  /** Set/override the live input estimate for the current turn (known at turn_start via getContextUsage). */
  setTurnInputEstimate(tokens: number): void {
    if (!this.turn) return;
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0)
      return;
    this.turn.liveInputTokens = Math.round(tokens);
  }

  private startMessage(message: AgentMessage): void {
    if (!this.turn || !isAssistantMessage(message)) return;
    const now = this.now();
    this.turn.currentMessage = {
      lastUpdateMs: now,
      firstOutputMs: null,
      inStall: false,
    };
  }

  private updateMessage(event: {
    message: AgentMessage;
    assistantMessageEvent: { type: string; delta: string };
  }): void {
    const turn = this.turn;
    const current = turn?.currentMessage;
    const streamEvent = event.assistantMessageEvent;
    const type = streamEvent.type;
    const message = event.message;
    if (!turn || !current || !isAssistantMessage(message)) return;

    const now = this.now();

    // TTFT — first streamed content of any kind (thinking counts). Mirrors
    // pi-core-tps-stats CONTENT_START_EVENTS. No delta needed; the start
    // signal itself is the observation. Return early so stall logic not
    // double-counts the first chunk's gap.
    if (CONTENT_START_EVENTS.has(type)) {
      if (turn.firstTokenMs === null) {
        turn.firstTokenMs = now;
      }
      if (current.firstOutputMs === null) {
        current.firstOutputMs = now;
        current.lastUpdateMs = now;
      }
      return;
    }

    // Live output estimation — only delta events carry char counts.
    if (!CONTENT_DELTA_EVENTS.has(type)) return;
    if (streamEvent.delta.length === 0) return;

    // Data layer: cheap O(1) per delta — no external tokenizer, ~4 chars/token is enough for 1 s throttled display
    turn.liveDeltaChars += streamEvent.delta.length;
    const estFromDelta = Math.ceil(turn.liveDeltaChars / 4);
    turn.liveEstimatedTokens = Math.max(estFromDelta, turn.liveEstimatedTokens);
    if (current.firstOutputMs === null) {
      current.firstOutputMs = now;
      turn.firstTokenMs ??= now;
      current.lastUpdateMs = now;
      return;
    }

    const gap = now - current.lastUpdateMs;
    if (gap >= STALL_THRESHOLD_MS) {
      if (!current.inStall) turn.stallCount++;
      current.inStall = true;
      turn.stallMs += gap;
    } else {
      current.inStall = false;
    }
    current.lastUpdateMs = now;
  }

  private endMessage(message: AgentMessage): void {
    const turn = this.turn;
    if (!turn || !isAssistantMessage(message)) return;

    const current = turn.currentMessage;
    if (current) {
      const endMs = this.now();
      turn.generationMs = endMs - turn.startMs;
      if (current.firstOutputMs === null && message.usage.output > 0) {
        turn.firstTokenMs ??= endMs;
      }
      turn.currentMessage = null;
    }
    turn.messages.push(message as AssistantMessage);
  }

  private endTurnAndCollect(): TurnTelemetry | undefined {
    const telemetry = this.endTurn();
    if (telemetry) {
      this.lastTurnTelemetry = telemetry;
      this.lastTelemetry = telemetry;
    }
    return telemetry;
  }

  private endTurn(): TurnTelemetry | undefined {
    const turn = this.turn;
    this.turn = undefined;
    if (!turn || turn.firstTokenMs === null || turn.messages.length === 0)
      return;

    const endMs = this.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;
    for (const message of turn.messages) {
      inputTokens += message.usage.input;
      outputTokens += message.usage.output;
      totalTokens += message.usage.totalTokens;
      costUsd += message.usage.cost.total;
    }
    if (
      ![inputTokens, outputTokens, totalTokens, costUsd].every(Number.isFinite)
    ) {
      throw new Error("Invalid assistant usage in turn telemetry");
    }

    const measurementMs =
      outputTokens > 0 && turn.generationMs > 0 ? turn.generationMs : null;
    // Final TPS uses whole-turn (turn.generationMs = end - start), same denominator as live.
    const raw = tps(outputTokens, endMs - turn.generationMs, endMs);
    const tpsVal =
      measurementMs === null || raw === undefined ? null : round(raw, 1);
    const validCost = Number.isFinite(costUsd) && costUsd > 0;
    const validTokens = Number.isFinite(totalTokens) && totalTokens > 0;
    return {
      tps: tpsVal,
      ttftMs: turn.firstTokenMs! - turn.startMs,
      totalMs: endMs - turn.startMs,
      inputTokens,
      outputTokens,
      stallMs: turn.stallMs,
      stallCount: turn.stallCount,
      rateUsdPerMTokens:
        validCost && validTokens
          ? round(costUsd / (totalTokens / 1_000_000), 2)
          : null,
      generationMs: turn.generationMs,
      totalTokens,
      costUsd: validCost ? costUsd : 0,
      measurementMs,
      estimated: false,
    };
  }
}

export function formatTurnDuration(ms: number): string {
  if (ms < 60_000) {
    // TTFT fixed width: 2-digit integer + one decimal -> padded 4 + "s" =5, then overall duration field padded to 7 for telemetry totalMs
    // For TTFT we want 5, for duration we want 7 — caller will pad accordingly, so here return 5 for <60s case
    return `${(ms / 1000).toFixed(1).padStart(4, " ")}s`;
  }
  return formatDuration(ms);
}

export interface MinimalTheme {
  fg(color: string, text: string): string;
}

export function formatTurnTelemetry(
  telemetry: TurnTelemetry,
  theme: MinimalTheme,
  config: TelemetryConfig,
  glyphs?: {
    speed: string;
    latency: string;
    done: string;
    input: string;
    output: string;
    stall: string;
    cost: string;
    dimSep?: string;
  },
): string {
  const g = glyphs ?? {
    speed: ">",
    latency: "~",
    done: "+",
    input: "↑",
    output: "↓",
    stall: "!",
    cost: "$",
  };
  const parts: string[] = [];
  if (config.tps) {
    const isEst = telemetry.estimated === true;
    let raw: string;
    if (telemetry.tps === null) raw = "—";
    else raw = `${isEst ? "~" : ""}${telemetry.tps.toFixed(1)}`;
    const padded = raw.padStart(6, " ");
    parts.push(
      theme.fg(
        telemetry.tps === null ? "muted" : "accent",
        `${padded} tok/s TPS`,
      ),
    );
  }
  if (config.ttft) {
    const sec = (telemetry.ttftMs / 1000).toFixed(1);
    const padded = sec.padStart(4, " ");
    parts.push(theme.fg("text", `${padded}s TTFT`));
  }
  if (config.stalls && telemetry.stallMs > 0) {
    parts.push(
      theme.fg(
        "warning",
        `${g.stall}${telemetry.stallCount}×${formatTurnDuration(telemetry.stallMs).trim()}`,
      ),
    );
  }
  if (parts.length === 0) return "";
  // Use theme dim for separator if not custom
  const joiner = g.dimSep ?? ` ${theme.fg("dim", "·")} `;
  return parts.join(joiner);
}

export function formatTelemetryTokens(
  telemetry: TurnTelemetry,
  theme: MinimalTheme,
  config: TelemetryConfig,
  glyphs?: {
    input: string;
    output: string;
    dimSep?: string;
  },
): string {
  if (!config.tokens) return "";
  const g = glyphs ?? {
    input: "↑",
    output: "↓",
  };
  const joiner =
    (g as { dimSep?: string }).dimSep ?? ` ${theme.fg("dim", "·")} `;
  const isEst = telemetry.estimated === true;
  // ~ prefix marks live estimate (chars/4, context window) vs authoritative usage
  const inPref = isEst ? "~" : "";
  const outPref = isEst ? "~" : "";
  const parts: string[] = [
    theme.fg(
      "accent",
      `${g.input} ${inPref}${fmtTokens(telemetry.inputTokens)}`,
    ),
    theme.fg(
      "success",
      `${g.output} ${outPref}${fmtTokens(telemetry.outputTokens)}`,
    ),
  ];
  return parts.join(joiner);
}
