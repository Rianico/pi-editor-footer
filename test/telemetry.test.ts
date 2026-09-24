import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatTurnTelemetry,
  TurnTelemetryTracker,
  type AssistantMessage,
  type TelemetryConfig,
} from "../src/telemetry.js";

const theme = {
  fg: (_color: string, text: string) => text,
};

const fullConfig: TelemetryConfig = {
  enabled: true,
  tps: true,
  ttft: true,
  duration: true,
  tokens: true,
  stalls: true,
  cost: true,
};

function makeMessage(output = 20, input = 50): AssistantMessage {
  const totalTokens = input + output;
  return {
    role: "assistant",
    content: [{ type: "text", text: "response" }],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-4",
    usage: {
      input,
      output,
      totalTokens,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: totalTokens * 0.000004,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function update(
  message: AssistantMessage,
  delta = "x",
  type = "text_delta",
  partial?: unknown,
): {
  type: "message_update";
  message: AssistantMessage;
  assistantMessageEvent: { type: string; delta: string; partial?: unknown };
} {
  return {
    type: "message_update",
    message: message as unknown as AssistantMessage & { role: string },
    assistantMessageEvent: {
      type,
      delta,
      ...(partial !== undefined ? { partial } : {}),
    },
  };
}
function startTurn(tracker: TurnTelemetryTracker, message: AssistantMessage, turnIndex = 0): void {
  tracker.handle({ type: "turn_start", turnIndex, timestamp: Date.now() });
  tracker.handle({
    type: "message_start",
    message: message as unknown as AssistantMessage & { role: string },
  });
}

function endTurn(tracker: TurnTelemetryTracker, message: AssistantMessage, turnIndex = 0) {
  tracker.handle({
    type: "message_end",
    message: message as unknown as AssistantMessage & { role: string },
  });
  return tracker.handle({
    type: "turn_end",
    turnIndex,
    message: message as unknown as AssistantMessage & { role: string },
    toolResults: [],
  });
}

describe("TurnTelemetryTracker", () => {
  test("uses total output over full generation time", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    for (const timestamp of [4000, 4100]) {
      now = timestamp;
      tracker.handle(update(message));
    }
    now = 5000;
    const telemetry = endTurn(tracker, message);
    assert.deepEqual(telemetry, {
      tps: 4,
      ttftMs: 4000,
      totalMs: 5000,
      inputTokens: 50,
      outputTokens: 20,
      stallMs: 4000, // 4 s message_start→first-bytes silence counts as a pre-token stall
      stallCount: 1,
      rateUsdPerMTokens: 4,
      generationMs: 5000,
      totalTokens: 70,
      costUsd: 0.00028,
      measurementMs: 5000,
      ttftProviderMs: null, // no before_provider_request in this turn (no generation-window rate exposed)
      estimated: false,
    });
    assert.equal(
      formatTurnTelemetry(telemetry!, theme, fullConfig),
      "   4.0 tok/s TPS ·  4.0s TTFT · !1×4.0s",
    );
  });

  test("measures non-streamed responses from turn start", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();

    tracker.handle({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
    now = 5000;
    tracker.handle({
      type: "message_start",
      message: message as unknown as AssistantMessage & { role: string },
    });
    tracker.handle({
      type: "message_end",
      message: message as unknown as AssistantMessage & { role: string },
    });
    const telemetry = tracker.handle({
      type: "turn_end",
      turnIndex: 0,
      message: message as unknown as AssistantMessage & { role: string },
      toolResults: [],
    })!;

    assert.equal(telemetry.tps, 4);
    assert.equal(telemetry.ttftMs, 5000);
    assert.equal(telemetry.generationMs, 5000);
    assert.equal(telemetry.measurementMs, 5000);
  });

  test("returns no TPS without output or generation time", () => {
    const scenarios = [
      { name: "zero duration", updates: [0, 0], endMs: 0, output: 20 },
      { name: "zero output", updates: [100, 200], endMs: 800, output: 0 },
    ];

    for (const scenario of scenarios) {
      let now = 0;
      const tracker = new TurnTelemetryTracker(() => now);
      const message = makeMessage(scenario.output);
      startTurn(tracker, message);
      for (const timestamp of scenario.updates) {
        now = timestamp;
        tracker.handle(update(message));
      }
      now = scenario.endMs;
      const telemetry = endTurn(tracker, message);
      assert.equal(telemetry?.tps, null, scenario.name);
      assert.equal(telemetry?.outputTokens, scenario.output, scenario.name);
    }
  });

  test("keeps stalls in delivery time so they lower TPS", () => {
    function measure(updates: number[], endMs: number) {
      let now = 0;
      const tracker = new TurnTelemetryTracker(() => now);
      const message = makeMessage();
      startTurn(tracker, message);
      for (const timestamp of updates) {
        now = timestamp;
        tracker.handle(update(message));
      }
      now = endMs;
      return endTurn(tracker, message)!;
    }

    const uninterrupted = measure([100, 200, 300], 800);
    const stalled = measure([100, 1200, 2300, 2400, 3500], 3600);

    assert.equal(uninterrupted.tps, 25);
    assert.equal(stalled.tps, 5.6);
    assert.ok(stalled.tps! < uninterrupted.tps!);
    assert.equal(stalled.stallMs, 3300);
    assert.equal(stalled.stallCount, 2);
    assert.match(formatTurnTelemetry(stalled, theme, fullConfig), /!2×\s*3\.3s/);
  });

  test("getLastTelemetry returns last turn", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage(10, 10);
    startTurn(tracker, message);
    now = 100;
    tracker.handle(update(message));
    now = 1000;
    const tel = endTurn(tracker, message)!;
    assert.deepEqual(tracker.getLastTelemetry(), tel);
  });

  test("adopts streamed usage.output when provider reports it mid-stream", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 1000;
    // 2 chars -> chars/4 estimate would be 1; provider reports exact 25
    tracker.handle(update(message, "hi", "text_delta", { usage: { output: 25 } }));
    const live = tracker.peekLive()!;
    assert.equal(live.outputTokens, 25);
    assert.equal(live.estimated, true);
  });

  test("falls back to chars/4 when streamed usage is absent or zero", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 1000;
    tracker.handle(update(message, "abcdefgh", "text_delta"));
    assert.equal(tracker.peekLive()!.outputTokens, 2);
    now = 1100;
    tracker.handle(update(message, "ijklmnop", "text_delta", { usage: { output: 0 } }));
    // 16 chars total -> ceil(16/4) = 4, zero usage must not clobber the estimate
    assert.equal(tracker.peekLive()!.outputTokens, 4);
  });

  test("streamed usage never regresses the live estimate", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 1000;
    tracker.handle(update(message, "hi", "text_delta", { usage: { output: 25 } }));
    assert.equal(tracker.peekLive()!.outputTokens, 25);
    now = 1100;
    tracker.handle(update(message, "hello world", "text_delta", { usage: { output: 10 } }));
    assert.equal(tracker.peekLive()!.outputTokens, 25);
  });

  test("anchors TTFT to first delta, not start signal", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 1000;
    tracker.handle(update(message, "", "text_start"));
    // start signal carries no bytes — still pre-first-token
    assert.equal(tracker.peekLive()?.ttftMs, 0);
    now = 1500;
    tracker.handle(update(message, "hello", "text_delta"));
    assert.equal(tracker.peekLive()!.ttftMs, 1500);
  });

  test("exposes provider-anchored TTFT alongside whole-turn TPS", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    tracker.handle({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
    now = 1000;
    tracker.handle({ type: "before_provider_request" });
    tracker.handle({ type: "message_start", message });
    now = 1200;
    tracker.handle({ type: "before_provider_request" }); // retry: first anchor wins
    now = 1500;
    tracker.handle(update(message, "0123456789012345678901234567890123456789", "text_delta")); // 40 chars -> 10
    now = 2500;
    const live = tracker.peekLive()!;
    assert.equal(live.outputTokens, 10);
    assert.equal(live.ttftMs, 1500); // turn-relative: includes queue/prefill
    assert.equal(live.ttftProviderMs, 500); // request-relative: true network TTFT
    assert.equal(live.tps, 4); // whole-turn: 10 / 2.5s
  });

  test("provider anchor is null when unobserved and safe when idle", () => {
    const tracker = new TurnTelemetryTracker(() => 0);
    tracker.handle({ type: "before_provider_request" }); // no turn — no-op, no throw
    assert.equal(tracker.peekLive(), null);
    const message = makeMessage();
    startTurn(tracker, message);
    assert.equal(tracker.peekLive()?.ttftProviderMs, null);
  });

  test("counts a start-to-first-bytes stall instead of swallowing it", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 500;
    tracker.handle(update(message, "", "text_start"));
    now = 3500; // 3.5 s of dead air before first bytes — a prefill stall
    tracker.handle(update(message, "hello", "text_delta"));
    const live = tracker.peekLive()!;
    assert.equal(live.ttftMs, 3500);
    assert.equal(live.stallCount, 1);
    assert.equal(live.stallMs, 3500);
  });

  test("anchors TTFT on a start that already carries complete content", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 1000;
    // redacted thinking / no-arg tool calls: complete content at start, never any deltas
    tracker.handle(
      update(message, "", "thinking_start", {
        content: [{ type: "thinking", thinking: "redacted" }],
      }),
    );
    assert.equal(tracker.peekLive()!.ttftMs, 1000);
  });

  test("named toolcall starts anchor, empty text starts wait for deltas", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();
    startTurn(tracker, message);
    now = 1000;
    // translators push the (empty) block before its start — no output produced yet
    tracker.handle(update(message, "", "text_start", { content: [{ type: "text", text: "" }] }));
    assert.equal(tracker.peekLive()?.ttftMs, 0);
    now = 1200;
    // the named call itself is produced output, even with args still streaming
    tracker.handle(
      update(message, "", "toolcall_start", {
        content: [{ type: "toolCall", id: "call_1", name: "get_time", arguments: {} }],
      }),
    );
    assert.equal(tracker.peekLive()!.ttftMs, 1200);
  });
  test("respects telemetry segment settings", () => {
    const telemetry = {
      tps: 50,
      ttftMs: 200,
      totalMs: 900,
      inputTokens: 50,
      outputTokens: 20,
      stallMs: 800,
      stallCount: 1,
      rateUsdPerMTokens: 4,
      generationMs: 700,
      totalTokens: 70,
      costUsd: 0.00028,
      measurementMs: 400,
    };
    const hidden: TelemetryConfig = {
      enabled: false,
      tps: false,
      ttft: false,
      duration: false,
      tokens: false,
      stalls: false,
      cost: false,
    };
    assert.equal(formatTurnTelemetry(telemetry, theme, hidden), "");
  });
});
