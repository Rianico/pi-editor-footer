/**
 * Turn telemetry tracker — pure, TUI-free.
 *
 * Rebuilt bespoke from tmp/pi-open-tui/extensions/open-tui/telemetry.ts.
 * No imports beyond stdlib and pi-tui width utils omitted here (pure maths).
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
  | { type: "agent_settled" }
  | { type: "turn_start"; turnIndex?: number; timestamp?: number }
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
}

function isAssistantMessage(message: AgentMessage): boolean {
  return message.role === "assistant";
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Fallback token estimate when pi-coding-agent's estimateTokens is unavailable. ~4 chars per token. */
function estimateTokensFallback(content: unknown): number {
  try {
    if (typeof content === "string")
      return Math.max(0, Math.ceil(content.length / 4));
    if (Array.isArray(content)) {
      let total = 0;
      for (const block of content) {
        if (typeof block === "string")
          total += Math.ceil((block as string).length / 4);
        else if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string")
            total += Math.ceil((b.text as string).length / 4);
          else if (typeof b.content === "string")
            total += Math.ceil((b.content as string).length / 4);
          else total += Math.ceil(JSON.stringify(block).length / 4);
        }
      }
      return total;
    }
    if (content && typeof content === "object")
      return Math.ceil(JSON.stringify(content).length / 4);
  } catch {
    void 0;
  }
  return 0;
}

function estimateMessageTokens(msg: AgentMessage): number {
  // Prefer pi-coding-agent's estimate if message already has token-ish length; fallback to content heuristic
  const c = (msg as unknown as { content?: unknown })?.content;
  return estimateTokensFallback(c);
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
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${s}s`;
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}h ${m}m ${s}s`;
}

export class TurnTelemetryTracker {
  private readonly now: () => number;
  private turn: TurnTiming | undefined;
  private agentStartMs: number | null = null;
  private agentTurns: TurnTelemetry[] = [];
  private lastTelemetry: TurnTelemetry | null = null;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  getLastTelemetry(): TurnTelemetry | null {
    return this.lastTelemetry;
  }
  /** Live snapshot while a turn is running — for real-time border refresh. Returns null when idle. */
  peekLive(): TurnTelemetry | null {
    const turn = this.turn;
    if (!turn) return null;
    const now = this.now();
    const elapsed = Math.max(0, now - turn.startMs);
    // before first token — show running duration only
    if (turn.firstTokenMs === null) {
      return {
        tps: null,
        ttftMs: 0,
        totalMs: elapsed,
        inputTokens: 0,
        outputTokens: 0,
        stallMs: turn.stallMs,
        stallCount: turn.stallCount,
        rateUsdPerMTokens: null,
        generationMs: elapsed,
        totalTokens: 0,
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
    // During streaming no message has ended yet — use live estimate so TPS refreshes in real time
    if (outputTokens === 0 && turn.liveEstimatedTokens > 0) {
      outputTokens = turn.liveEstimatedTokens;
      totalTokens = turn.liveEstimatedTokens;
    } else if (turn.liveEstimatedTokens > outputTokens) {
      // streaming extension of current message — reflect growth even before message_end
      outputTokens = turn.liveEstimatedTokens;
      totalTokens = Math.max(totalTokens, turn.liveEstimatedTokens);
    }
    const measurementMs = genMs > 0 && outputTokens > 0 ? genMs : null;
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
      case "agent_start":
        if (this.agentStartMs === null) {
          this.agentStartMs = this.now();
          this.agentTurns = [];
        }
        return;
      case "agent_settled":
        return this.endAgent();
      case "turn_start":
        this.startTurn();
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

  private startTurn(): void {
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
    };
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
    // Track live estimated tokens for real-time TPS during streaming
    turn.liveDeltaChars += streamEvent.delta.length;
    const estFromContent = estimateMessageTokens(message);
    const estFromDelta = Math.ceil(turn.liveDeltaChars / 4);
    turn.liveEstimatedTokens = Math.max(
      estFromContent,
      estFromDelta,
      turn.liveEstimatedTokens,
    );
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
    if (telemetry && this.agentStartMs !== null)
      this.agentTurns.push(telemetry);
    if (telemetry) this.lastTelemetry = telemetry;
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

  private endAgent(): TurnTelemetry | undefined {
    const startMs = this.agentStartMs;
    const turns = this.agentTurns;
    this.agentStartMs = null;
    this.agentTurns = [];
    if (startMs === null || turns.length === 0) return;

    const outputTokens = turns.reduce((sum, t) => sum + t.outputTokens, 0);
    const inputTokens = turns.reduce((sum, t) => sum + t.inputTokens, 0);
    const totalTokens = turns.reduce((sum, t) => sum + t.totalTokens, 0);
    const costUsd = turns.reduce((sum, t) => sum + t.costUsd, 0);
    const stallMs = turns.reduce((sum, t) => sum + t.stallMs, 0);
    const stallCount = turns.reduce((sum, t) => sum + t.stallCount, 0);
    const generationMs = turns.reduce((sum, t) => sum + t.generationMs, 0);
    const measurementMs =
      outputTokens > 0 && generationMs > 0 ? generationMs : null;
    const tps =
      measurementMs === null
        ? null
        : round(outputTokens / (measurementMs / 1000), 1);
    const validRate = costUsd > 0 && totalTokens > 0;
    const result: TurnTelemetry = {
      tps,
      ttftMs: turns[0]!.ttftMs,
      totalMs: this.now() - startMs,
      inputTokens,
      outputTokens,
      stallMs,
      stallCount,
      rateUsdPerMTokens: validRate
        ? round(costUsd / (totalTokens / 1_000_000), 2)
        : null,
      generationMs,
      totalTokens,
      costUsd,
      measurementMs,
    };
    this.lastTelemetry = result;
    return result;
  }
}

function formatTurnDuration(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(ms);
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
    const value =
      telemetry.tps === null ? "—" : `${telemetry.tps.toFixed(1)} tok/s`;
    parts.push(
      theme.fg(
        telemetry.tps === null ? "muted" : "accent",
        `${g.speed} TPS ${value}`,
      ),
    );
  }
  if (config.ttft) {
    parts.push(
      theme.fg(
        "text",
        `${g.latency} TTFT ${formatTurnDuration(telemetry.ttftMs)}`,
      ),
    );
  }
  if (config.duration) {
    parts.push(
      theme.fg("success", `${g.done} ${formatTurnDuration(telemetry.totalMs)}`),
    );
  }
  if (config.tokens) {
    parts.push(
      theme.fg("accent", `${g.input} ${fmtTokens(telemetry.inputTokens)}`),
    );
    parts.push(
      theme.fg("success", `${g.output} ${fmtTokens(telemetry.outputTokens)}`),
    );
  }
  if (config.stalls && telemetry.stallMs > 0) {
    parts.push(
      theme.fg(
        "warning",
        `${g.stall} stall ${telemetry.stallCount}x / ${formatTurnDuration(telemetry.stallMs)}`,
      ),
    );
  }
  if (config.cost && telemetry.rateUsdPerMTokens !== null) {
    const rate = telemetry.rateUsdPerMTokens.toFixed(2);
    // Avoid "$ $0.16/M" when the cost glyph itself is "$" (ascii) — glyph already is the currency symbol
    const costText = g.cost === "$" ? `$${rate}/M` : `${g.cost} $${rate}/M`;
    parts.push(theme.fg("warning", costText));
  }
  if (parts.length === 0) return "";
  // Use theme dim for separator if not custom
  const joiner = g.dimSep ?? ` ${theme.fg("dim", "|")} `;
  return parts.join(joiner);
}
