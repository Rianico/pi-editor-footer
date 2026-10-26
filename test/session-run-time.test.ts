/**
 * Session run time (GLOSSARY: cumulative wall time of every Agent run).
 *
 * Pinned here: the accumulator's run lifecycle (sequential runs sum, an aborted
 * run counts up to the abort, a stray settle cannot double-count), the restore
 * from persisted custom entries (LAST entry wins — each stores cumulative
 * seconds), the orchestrator wiring (append on agent_settled ONLY, never
 * agent_end; unconditional of the display toggle), and the composed label the
 * BorderRenderer produces (dim pipes between present fields, no dangling `|`).
 */
import assert from "node:assert/strict";
import { describe, test, afterEach, beforeEach } from "node:test";
import { BorderRenderer } from "../src/border-renderer.js";
import { DEFAULT_CONFIG, type ThemeConfig } from "../src/config.js";
import {
  SESSION_RUN_TIME_ENTRY_TYPE,
  SessionRunTimeAccumulator,
  restoreSessionRunTimeMs,
} from "../src/session-run-time.js";
import { SessionOrchestrator } from "../src/session-orchestrator.js";
import { formatDuration } from "../src/format.js";
import type { ThemeLike } from "../src/model-info.js";

// ———————————————— shared fakes ————————————————

const identityTheme: ThemeLike = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (s: string) => s,
  fg: (_style: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  muted: (text: string) => text,
};

function runTimeEntry(seconds: number, id: string): Record<string, unknown> {
  return { type: "custom", customType: SESSION_RUN_TIME_ENTRY_TYPE, data: { seconds }, id };
}

function timelineEntry(id: string): Record<string, unknown> {
  return { type: "custom", customType: "timeline", data: { text: "2026-08-21 · 8s" }, id };
}

function fakePi(withAppend = true) {
  const handlers = new Map<string, ((e: unknown, ctx: unknown) => void)[]>();
  const appended: Array<{ type: string; data: unknown }> = [];
  return {
    handlers,
    appended,
    on(event: string, handler: (e: unknown, ctx: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand() {},
    registerShortcut() {},
    ...(withAppend
      ? { appendEntry: (type: string, data: unknown) => appended.push({ type, data }) }
      : {}),
  };
}

function fire(raw: ReturnType<typeof fakePi>, name: string, e: unknown, ctx: unknown): void {
  for (const h of raw.handlers.get(name) ?? []) h(e, ctx);
}

function fakeCtx(entries: unknown[] = []) {
  return {
    mode: "tui",
    ui: {
      setEditorComponent: () => {},
      setWidget: () => {},
      theme: { fg: (_c: string, s: string) => s, getColorMode: () => "truecolor" },
      notify: () => {},
    },
    sessionManager: {
      getCwd: () => "/tmp",
      getEntries: () => entries,
      getSessionName: () => undefined,
    },
    model: { provider: "test", id: "model", contextWindow: 200_000 },
    thinkingLevel: "off",
  };
}

/** Controllable clock — the orchestrator's deltas are Date.now() diffs. */
function useClock(): { set: (ms: number) => void; restore: () => void } {
  const real = Date.now;
  let nowMs = 1_000_000;
  Date.now = () => nowMs;
  return {
    set: (ms: number) => void (nowMs = ms),
    restore: () => void (Date.now = real),
  };
}

/** Every orchestrator created by tests — drained in afterEach so a failing test
 * cannot leak the watchdog interval and hold the runner's event loop open. */
const createdOrchestrators: SessionOrchestrator[] = [];

function orchestratorWithStubs(config?: (c: ThemeConfig) => void) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  config?.(cfg);
  const orch = new SessionOrchestrator({
    loadConfig: () => cfg,
    createGitRefresher: () => ({ start() {}, request() {}, stop() {} }),
  });
  createdOrchestrators.push(orch);
  return orch;
}

// ———————————————— accumulator ————————————————

describe("SessionRunTimeAccumulator", () => {
  test("two sequential runs sum; idle time between runs is excluded", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(10_000);
    acc.settleRun(18_000); // 8s run
    acc.settleRun(90_000); // idle gap — no live run, no-op
    acc.startRun(90_000);
    acc.settleRun(93_500); // 3.5s run
    assert.equal(acc.settled(), 11_500);
    const snap = acc.snapshot(200_000);
    assert.equal(snap.totalMs, 11_500);
    assert.equal(snap.running, false);
  });

  test("an aborted run counts its elapsed time (settle without normal end)", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.settleRun(4_200); // agent_settled fires for aborts too — same fold
    assert.equal(acc.settled(), 4_200);
  });

  test("stray second settle is a no-op (no double count)", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.settleRun(5_000);
    acc.settleRun(9_000);
    assert.equal(acc.settled(), 5_000);
  });

  test("live snapshot: accumulated + in-flight elapsed, growing on every read", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.settleRun(60_000);
    acc.startRun(100_000);
    assert.deepEqual(acc.snapshot(105_000), { totalMs: 65_000, running: true });
    assert.deepEqual(acc.snapshot(108_000), { totalMs: 68_000, running: true });
  });

  test("settle without a live run is a no-op; fresh accumulator is 0", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.settleRun(1_000);
    assert.equal(acc.settled(), 0);
    assert.deepEqual(acc.snapshot(5_000), { totalMs: 0, running: false });
  });
});

// ———————————————— restore from session history ————————————————

describe("restoreSessionRunTimeMs", () => {
  test("LAST session-run-time entry wins (each stores cumulative seconds)", () => {
    const entries = [
      runTimeEntry(10, "e1"),
      timelineEntry("e2"),
      runTimeEntry(158, "e3"),
      runTimeEntry(245, "e4"),
    ];
    assert.equal(restoreSessionRunTimeMs(entries), 245_000);
  });

  test("ignores other custom types, message entries, and malformed payloads", () => {
    assert.equal(restoreSessionRunTimeMs([timelineEntry("e1"), { type: "message" }]), 0);
    assert.equal(
      restoreSessionRunTimeMs([
        runTimeEntry(10, "e1"),
        { type: "custom", customType: SESSION_RUN_TIME_ENTRY_TYPE, data: {} },
      ]),
      0,
    );
    assert.equal(restoreSessionRunTimeMs(undefined), 0);
    assert.equal(restoreSessionRunTimeMs([]), 0);
  });
});

// ———————————————— orchestrator wiring ————————————————

describe("SessionOrchestrator — session run time", () => {
  let clock: ReturnType<typeof useClock> | null = null;
  // Apply the clock PER TEST: a describe-level stub leaks into the rest of the
  // file, and one shared restore would strip it after the very first test.
  beforeEach(() => {
    clock = useClock();
  });
  afterEach(() => {
    while (createdOrchestrators.length > 0) createdOrchestrators.pop()?.dispose();
    clock?.restore();
  });

  test("session_start restores the accumulator; a fresh session starts at 0", () => {
    const resumed = orchestratorWithStubs();
    const raw = fakePi();
    resumed.install(raw as never);
    fire(raw, "session_start", {}, fakeCtx([runTimeEntry(100, "e1"), runTimeEntry(245, "e2")]));
    assert.equal(resumed.getSessionRunTime().snapshot().totalMs, 245_000);

    const fresh = orchestratorWithStubs();
    const rawFresh = fakePi();
    fresh.install(rawFresh as never);
    fire(rawFresh, "session_start", {}, fakeCtx([]));
    const snap = fresh.getSessionRunTime().snapshot();
    assert.equal(snap.totalMs, 0);
    assert.equal(formatDuration(snap.totalMs), "0s");
    resumed.dispose();
    fresh.dispose();
  });

  test("each agent_settled appends one cumulative entry; agent_end never does", () => {
    const orch = orchestratorWithStubs();
    const raw = fakePi();
    orch.install(raw as never);
    const ctx = fakeCtx([runTimeEntry(100, "e1")]);
    fire(raw, "session_start", {}, ctx);
    const before = raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE).length;
    assert.equal(before, 0, "restore appends nothing");

    clock.set(2_000_000);
    fire(raw, "agent_start", {}, ctx);
    clock.set(2_008_000);
    fire(raw, "agent_end", {}, ctx);
    assert.equal(
      raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE).length,
      0,
      "agent_end is not the accumulation hook",
    );
    fire(raw, "agent_settled", {}, ctx);
    const timeEntries = raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE);
    assert.deepEqual(timeEntries, [{ type: SESSION_RUN_TIME_ENTRY_TYPE, data: { seconds: 108 } }]);
    assert.equal(orch.getSessionRunTime().settled(), 108_000);
    orch.dispose();
  });

  test("two sequential runs accumulate; a second settle for the same run does not", () => {
    const orch = orchestratorWithStubs();
    const raw = fakePi();
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);
    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(8_000);
    fire(raw, "agent_settled", {}, ctx);
    clock.set(9_000);
    fire(raw, "agent_start", {}, ctx);
    clock.set(12_500);
    fire(raw, "agent_settled", {}, ctx);
    fire(raw, "agent_settled", { aborted: true }, ctx); // stray second settle
    const timeEntries = raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE);
    assert.deepEqual(
      timeEntries.map((a) => a.data),
      [{ seconds: 8 }, { seconds: 11 }],
    );
    assert.equal(orch.getSessionRunTime().settled(), 11_500);
    orch.dispose();
  });

  test("an aborted run counts up to the abort", () => {
    const orch = orchestratorWithStubs();
    const raw = fakePi();
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);
    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(4_200);
    fire(raw, "agent_settled", { aborted: true }, ctx);
    const timeEntries = raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE);
    assert.deepEqual(timeEntries, [{ type: SESSION_RUN_TIME_ENTRY_TYPE, data: { seconds: 4 } }]);
    orch.dispose();
  });

  test("accumulation + persistence are unconditional of the display toggle", () => {
    const orch = orchestratorWithStubs((c) => void (c.sessionRunTime = false));
    const raw = fakePi();
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);
    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(6_000);
    fire(raw, "agent_settled", {}, ctx);
    assert.deepEqual(
      raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE),
      [{ type: SESSION_RUN_TIME_ENTRY_TYPE, data: { seconds: 6 } }],
    );
    assert.equal(orch.getSessionRunTime().settled(), 6_000);
    orch.dispose();
  });

  test("a pi without appendEntry still accumulates (display keeps counting)", () => {
    const orch = orchestratorWithStubs();
    const raw = fakePi(false);
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);
    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(3_000);
    fire(raw, "agent_settled", {}, ctx);
    assert.equal(orch.getSessionRunTime().settled(), 3_000);
    orch.dispose();
  });
});

// ———————————————— composed label (BorderRenderer) ————————————————

function topRule(opts: {
  contextText?: string;
  runTimeText?: string;
  glowEnabled?: boolean;
  width?: number;
}): string {
  const renderer = new BorderRenderer(
    () => identityTheme,
    () => ({
      provider: "opencode-go",
      modelId: "deepseek-v4.1-flash",
      level: "high",
      contextWindow: 200_000,
    }),
  );
  return (
    renderer.renderWithBorders(["hello"], opts.width ?? 100, {
      glowEnabled: opts.glowEnabled ?? true,
      topContextText: opts.contextText,
      topRunTimeText: opts.runTimeText,
    })[0] ?? ""
  );
}

describe("session run time in the composed top label", () => {
  test("rightmost field: model label | context | run time (target render)", () => {
    const line = topRule({ contextText: "c 87.3% · 12.3% · 45k/200k", runTimeText: "2h 32m 1s" });
    assert.ok(
      line.includes(
        "opencode-go/deepseek-v4.1-flash · high | c 87.3% · 12.3% · 45k/200k | 2h 32m 1s",
      ),
      line,
    );
  });

  test("format boundaries ride formatDuration through the composed label", () => {
    for (const [ms, expected] of [
      [8_000, "8s"],
      [303_000, "5m 3s"],
      [9_121_000, "2h 32m 1s"],
    ] as const) {
      const line = topRule({ contextText: "CTX", runTimeText: formatDuration(ms) });
      assert.ok(line.includes(`CTX | ${expected}`), `${expected}: ${line}`);
    }
  });

  test("context bar off → no dangling pipe: model label | run time", () => {
    const line = topRule({ contextText: "", runTimeText: "8s" });
    assert.ok(line.includes("opencode-go/deepseek-v4.1-flash · high | 8s"), line);
    assert.ok(!line.includes("| |"), line);
    assert.ok(!line.includes("8s |"), line);
  });

  test("run time off → label identical to the pre-feature shape (no trailing pipe)", () => {
    const withTime = topRule({ contextText: "CTX", runTimeText: "" });
    const withoutField = topRule({ contextText: "CTX" });
    assert.equal(withTime, withoutField);
    assert.ok(withoutField.includes("high | CTX"), withoutField);
    assert.ok(!withoutField.includes("CTX |"), withoutField);
  });

  test("both off → no field pipes on the top rule at all", () => {
    const line = topRule({});
    assert.ok(!line.includes("|"), line);
  });

  test("glow off → the field still composes (plain path, no model label)", () => {
    // Width ≤ 30 renders unframed — the plain path where glow-off drops the model
    // label. (At wider widths the framed path always keeps it, glow or not.)
    const line = topRule({ contextText: "CTX", runTimeText: "8s", glowEnabled: false, width: 24 });
    assert.ok(line.includes("CTX | 8s"), line);
    const timeOnly = topRule({ runTimeText: "8s", glowEnabled: false, width: 24 });
    assert.ok(timeOnly.includes("8s"), timeOnly);
    assert.ok(!timeOnly.includes("|"), timeOnly);
  });
});
