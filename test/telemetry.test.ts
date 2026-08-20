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
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalTokens * 0.000004 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function update(
  message: AssistantMessage,
  delta = "x",
  type = "text_delta",
): { type: "message_update"; message: AssistantMessage; assistantMessageEvent: { type: string; delta: string } } {
  return {
    type: "message_update",
    message: message as unknown as AssistantMessage & { role: string },
    assistantMessageEvent: { type, delta },
  };
}

function startTurn(tracker: TurnTelemetryTracker, message: AssistantMessage, turnIndex = 0): void {
  tracker.handle({ type: "turn_start", turnIndex, timestamp: Date.now() });
  tracker.handle({ type: "message_start", message: message as unknown as AssistantMessage & { role: string } });
}

function endTurn(tracker: TurnTelemetryTracker, message: AssistantMessage, turnIndex = 0) {
  tracker.handle({ type: "message_end", message: message as unknown as AssistantMessage & { role: string } });
  return tracker.handle({ type: "turn_end", turnIndex, message: message as unknown as AssistantMessage & { role: string }, toolResults: [] });
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
      stallMs: 0,
      stallCount: 0,
      rateUsdPerMTokens: 4,
      generationMs: 5000,
      totalTokens: 70,
      costUsd: 0.00028,
      measurementMs: 5000,
    });
    assert.equal(
      formatTurnTelemetry(telemetry!, theme, fullConfig),
      "> TPS 4.0 tok/s | ~ TTFT 4.0s | + 5.0s | ↑ 50 | ↓ 20 | $ $4.00/M",
    );
  });

  test("measures non-streamed responses from turn start", () => {
    let now = 0;
    const tracker = new TurnTelemetryTracker(() => now);
    const message = makeMessage();

    tracker.handle({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
    now = 5000;
    tracker.handle({ type: "message_start", message: message as unknown as AssistantMessage & { role: string } });
    tracker.handle({ type: "message_end", message: message as unknown as AssistantMessage & { role: string } });
    const telemetry = tracker.handle({ type: "turn_end", turnIndex: 0, message: message as unknown as AssistantMessage & { role: string }, toolResults: [] })!;

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
    assert.match(formatTurnTelemetry(stalled, theme, fullConfig), /! stall 2x \/ 3\.3s/);
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
