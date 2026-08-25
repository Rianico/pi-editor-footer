/**
 * Turn telemetry tracker — pure, TUI-free. Turn-scoped only.
 *
 * Rebuilt bespoke from tmp/pi-open-tui/extensions/open-tui/telemetry.ts.
 * No imports beyond stdlib and pi-tui width utils omitted here (pure maths).
 *
 * Agent-run lifecycle is owned by AgentRunLedger (agent-run-ledger.ts) —
 * this tracker deliberately has NO agent window (no agentStartMs/agentTurns/
 * peekAgentLive). Agent events are accepted as no-ops for event-shape compat.
 */

const STALL_THRESHOLD_MS = 1000;

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

  /** Live snapshot while a turn is running — for real-time border refresh. Returns null when idle. */
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
      };
    }
    const genMs = Math.max(0, now - turn.firstTokenMs);
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
    // During streaming no message has ended yet — use live estimate so TPS refreshes in real time
    if (outputTokens === 0 && turn.liveEstimatedTokens > 0) {
      outputTokens = turn.liveEstimatedTokens;
      totalTokens = Math.max(totalTokens, inputTokens + outputTokens);
    } else if (turn.liveEstimatedTokens > outputTokens) {
      // streaming extension of current message — reflect growth even before message_end
      outputTokens = turn.liveEstimatedTokens;
      totalTokens = Math.max(totalTokens, inputTokens + outputTokens);
    }
    // Require minimum window to avoid spike on tiny genMs (multi-turn fast second turn)
    const measurementMs = genMs >= 500 && outputTokens > 0 ? genMs : null;
    const tps =
      measurementMs === null
        ? null
        : round(outputTokens / (measurementMs / 1000), 1);
    const validCost = Number.isFinite(costUsd) && costUsd > 0;
    const validTokens = Number.isFinite(totalTokens) && totalTokens > 0;
    return {
      tps,
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
      generationMs: genMs,
      totalTokens,
      costUsd: validCost ? costUsd : 0,
      measurementMs,
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
    if (
      streamEvent.type !== "text_delta" &&
      streamEvent.type !== "thinking_delta" &&
      streamEvent.type !== "toolcall_delta"
    )
      return;
    if (streamEvent.delta.length === 0) return;
    const message = event.message;
    if (!turn || !current || !isAssistantMessage(message)) return;

    const now = this.now();
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
    const tps =
      measurementMs === null
        ? null
        : round(outputTokens / (measurementMs / 1000), 1);
    const validCost = Number.isFinite(costUsd) && costUsd > 0;
    const validTokens = Number.isFinite(totalTokens) && totalTokens > 0;
    return {
      tps,
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
    const num = telemetry.tps === null ? "—" : telemetry.tps.toFixed(1);
    const padded = num.padStart(6, " ");
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
  const parts: string[] = [
    theme.fg("accent", `${g.input} ${fmtTokens(telemetry.inputTokens)}`),
    theme.fg("success", `${g.output} ${fmtTokens(telemetry.outputTokens)}`),
  ];
  return parts.join(joiner);
}
