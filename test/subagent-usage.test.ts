/**
 * Delegated work in the session figures (#66).
 *
 * Pinned here, one describe per acceptance line:
 *   1. a foreground delegation leaves the session run time at the parent's window;
 *   2. a background child extends it while the parent is idle, and concurrent
 *      children are a UNION of intervals — never a sum;
 *   3. delegated child usage lands in the session totals (footer + timeline source);
 *   4. a resumed session keeps child time and usage, counted once;
 *   5. the `subagentUsage` toggle off reproduces the parent-only figures exactly;
 *   6. no subagent extension (no event bus, unknown payloads) changes nothing and throws nothing.
 *
 * The pi-subagents payload shapes read here are external and version-sensitive:
 * see docs/reference/pi-subagents-events.md.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { DEFAULT_CONFIG, type ThemeConfig } from "../src/config.js";
import { SessionRunTimeAccumulator, SESSION_RUN_TIME_ENTRY_TYPE } from "../src/session-run-time.js";
import {
  SUBAGENT_USAGE_ENTRY_TYPE,
  SubagentUsageLedger,
  lastSubagentUsageRecords,
  restoreSubagentUsageRecords,
  subagentUsageFromAsyncComplete,
  subagentUsageFromToolResult,
  type SubagentUsageRecord,
} from "../src/subagent-usage.js";
import { SessionOrchestrator } from "../src/session-orchestrator.js";
import { getUsageTotals, invalidateUsageCache } from "../src/state.js";
import { installFooter } from "../src/footer.js";
import { createInitialState } from "../src/state.js";
import { LiveBorder } from "../src/live-border.js";
import { buildTimelineText } from "../src/transcript-timeline.js";
import { AgentRunLedger } from "../src/agent-run-ledger.js";

// ———————————————— shared fakes ————————————————

const identity = (s: string): string => s;

const identityTheme = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => identity,
  fg: (_style: string, s: string) => s,
  bold: identity,
  dim: identity,
  muted: identity,
};

function childUsage(over: Partial<SubagentUsageRecord> = {}): SubagentUsageRecord {
  return {
    key: "run-a#0",
    input: 1_200,
    output: 300,
    cacheRead: 4_000,
    cacheWrite: 100,
    cost: 0.05,
    ...over,
  };
}

function subagentUsageEntry(records: SubagentUsageRecord[], id: string): Record<string, unknown> {
  return { type: "custom", customType: SUBAGENT_USAGE_ENTRY_TYPE, data: { records }, id };
}

function runTimeEntry(seconds: number, id: string): Record<string, unknown> {
  return { type: "custom", customType: SESSION_RUN_TIME_ENTRY_TYPE, data: { seconds }, id };
}

/** Foreground tool result as pi hands it to `tool_execution_end` (pi-subagents details shape). */
function foregroundResult(options: {
  toolCallId: string;
  runId?: string;
  children?: Array<{
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: number;
  }>;
  mode?: string;
}): Record<string, unknown> {
  return {
    content: [{ type: "text", text: "delegated" }],
    details: {
      mode: options.mode ?? "single",
      ...(options.runId ? { runId: options.runId } : {}),
      results: (options.children ?? [{}]).map((child) => ({
        agent: "worker",
        usage: {
          input: child.input ?? 0,
          output: child.output ?? 0,
          cacheRead: child.cacheRead ?? 0,
          cacheWrite: child.cacheWrite ?? 0,
          cost: child.cost ?? 0,
          turns: 3,
        },
      })),
    },
  };
}

function asyncComplete(runId: string, usage: Record<string, unknown>): Record<string, unknown> {
  return {
    runId,
    id: runId,
    agent: "worker",
    mode: "single",
    state: "complete",
    success: true,
    results: [{ agent: "worker", usage }],
  };
}

function fakeEventBus(): {
  bus: { on(channel: string, handler: (data: unknown) => void): () => void };
  emit: (channel: string, data: unknown) => void;
  listeners: (channel: string) => number;
} {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    bus: {
      on(channel, handler) {
        const set = handlers.get(channel) ?? new Set();
        set.add(handler);
        handlers.set(channel, set);
        return () => void set.delete(handler);
      },
    },
    emit(channel, data) {
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
    listeners(channel) {
      return handlers.get(channel)?.size ?? 0;
    },
  };
}

function fakePi(options: { events?: unknown; withAppend?: boolean } = {}) {
  const handlers = new Map<string, ((e: unknown, ctx: unknown) => void)[]>();
  const appended: Array<{ type: string; data: unknown }> = [];
  const on = (event: string, handler: (e: unknown, ctx: unknown) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
  };
  return {
    handlers,
    appended,
    ...(options.events === undefined ? {} : { events: options.events }),
    on,
    registerCommand() {},
    registerShortcut() {},
    ...(options.withAppend === false
      ? {}
      : { appendEntry: (type: string, data: unknown) => appended.push({ type, data }) }),
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
    getContextUsage: () => ({ percent: 0, tokens: 0, contextWindow: 200_000 }),
    model: { provider: "test", id: "model", contextWindow: 200_000 },
    thinkingLevel: "off",
  };
}

function useClock(): { set: (ms: number) => void; restore: () => void } {
  const real = Date.now;
  let nowMs = 1_000_000;
  Date.now = () => nowMs;
  return {
    set: (ms: number) => void (nowMs = ms),
    restore: () => void (Date.now = real),
  };
}

const createdOrchestrators: SessionOrchestrator[] = [];

function orchestratorWithStubs(config?: (c: ThemeConfig) => void) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  config?.(cfg);
  const orch = new SessionOrchestrator({
    loadConfig: () => cfg,
    createGitRefresher: () => ({ start() {}, request() {}, stop() {} }),
  });
  createdOrchestrators.push(orch);
  return { orch, cfg };
}

// ———————————————— 1 · 2 · 5 · 6 — the session run time union ————————————————

describe("session run time — delegated intervals", () => {
  test("AC1: a foreground delegation leaves the figure at the parent's window", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    // The child's window sits inside the parent run — a sync tool call.
    acc.startSubagent("child-1", 2_000);
    acc.settleSubagent("child-1", 5_000);
    acc.settleRun(8_000);
    assert.equal(acc.settled(), 8_000);
    assert.equal(acc.snapshot(9_000).totalMs, 8_000);
  });

  test("AC2: a background child while the parent is idle extends the figure", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.settleRun(5_000); // parent ran 5s, then went idle
    acc.startSubagent("child-1", 10_000);
    // Live: the child window grows on every read even though no parent run is in flight.
    assert.equal(acc.snapshot(16_000).totalMs, 11_000);
    assert.equal(acc.snapshot(16_000).running, false);
    acc.settleSubagent("child-1", 18_000); // 8s of child-only time
    assert.equal(acc.settled(), 13_000);
    assert.equal(acc.hasLiveInterval(), false);
  });

  test("AC2: overlapping background children are unioned, not summed", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startSubagent("a", 0);
    acc.startSubagent("b", 2_000);
    acc.settleSubagent("a", 8_000);
    acc.settleSubagent("b", 10_000);
    // Sum would be 16s; the wall clock they occupied is 10s.
    assert.equal(acc.settled(), 10_000);
  });

  test("AC2: a child overlapping the parent run adds only the uncovered part", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.startSubagent("child-1", 4_000);
    acc.settleRun(6_000);
    acc.settleSubagent("child-1", 10_000); // 4s of it outlives the parent
    assert.equal(acc.settled(), 10_000);
  });

  test("AC5: includeSubagent=false answers the parent-only figure", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.settleRun(5_000);
    acc.startSubagent("child-1", 10_000);
    acc.settleSubagent("child-1", 18_000);
    assert.equal(acc.snapshot(20_000).totalMs, 13_000);
    assert.equal(acc.snapshot(20_000, { includeSubagent: false }).totalMs, 5_000);
  });

  test("AC5: without delegated intervals the two figures are identical", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.settleRun(4_200);
    acc.startRun(9_000);
    assert.deepEqual(acc.snapshot(9_500), acc.snapshot(9_500, { includeSubagent: false }));
  });

  test("AC4: only closed windows are settled, so a resume cannot double count", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.startRun(0);
    acc.startSubagent("child-1", 1_000); // still live at shutdown
    assert.equal(acc.settled(), 0, "an in-flight interval is never persisted");
  });

  test("AC6: an unknown child settle is a no-op (no negative or phantom interval)", () => {
    const acc = new SessionRunTimeAccumulator();
    acc.settleSubagent("never-started", 5_000);
    assert.equal(acc.settled(), 0);
    assert.equal(acc.hasLiveInterval(), false);
  });
});

// ———————————————— 3 — payload extraction ————————————————

describe("subagent usage payload extraction", () => {
  test("foreground tool result: one record per child, keyed by run id, tagged with the call", () => {
    const records = subagentUsageFromToolResult({
      toolCallId: "call-1",
      toolName: "subagent",
      result: foregroundResult({
        toolCallId: "call-1",
        runId: "run-a",
        mode: "parallel",
        children: [
          { input: 10, output: 2, cost: 0.01 },
          { input: 20, output: 3, cost: 0.02 },
        ],
      }),
    });
    assert.deepEqual(records, [
      {
        key: "run-a#0",
        toolCallId: "call-1",
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01,
      },
      {
        key: "run-a#1",
        toolCallId: "call-1",
        input: 20,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.02,
      },
    ]);
  });

  test("foreground tool result without a run id falls back to the tool call id", () => {
    const records = subagentUsageFromToolResult({
      toolCallId: "call-9",
      result: foregroundResult({ toolCallId: "call-9", children: [{ input: 5 }] }),
    });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.key, "call-9#0");
  });

  test("a tool result with no child usage yields nothing (management, async launch, other tools)", () => {
    assert.deepEqual(
      subagentUsageFromToolResult({
        toolCallId: "c",
        toolName: "bash",
        result: { details: { stdout: "x" } },
      }),
      [],
    );
    assert.deepEqual(
      subagentUsageFromToolResult({
        toolCallId: "c",
        result: { details: { mode: "management", results: [] } },
      }),
      [],
    );
    assert.deepEqual(
      subagentUsageFromToolResult({
        toolCallId: "c",
        result: { details: { mode: "single", results: [] } },
      }),
      [],
    );
    assert.deepEqual(subagentUsageFromToolResult({ toolCallId: "c" }), []);
  });

  test("async completion: results[].usage per child, keyed by the run id", () => {
    const records = subagentUsageFromAsyncComplete(
      asyncComplete("run-b", {
        input: 700,
        output: 90,
        cacheRead: 60,
        cacheWrite: 0,
        cost: 0.004,
        turns: 2,
      }),
    );
    assert.deepEqual(records, [
      { key: "run-b#0", input: 700, output: 90, cacheRead: 60, cacheWrite: 0, cost: 0.004 },
    ]);
  });

  test("async completion: totalCost carries the figure when no child usage block exists", () => {
    const records = subagentUsageFromAsyncComplete({
      runId: "run-c",
      results: [],
      totalCost: { inputTokens: 12, outputTokens: 3, costUsd: 0.002 },
    });
    assert.deepEqual(records, [
      { key: "run-c", input: 12, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.002 },
    ]);
  });

  test("async completion: unknown / empty payloads are ignored, never thrown on", () => {
    for (const junk of [undefined, null, 42, "x", [], {}, { runId: "r", results: [] }]) {
      assert.deepEqual(subagentUsageFromAsyncComplete(junk), [], JSON.stringify(junk));
    }
  });
});

// ———————————————— 3 · 4 — the ledger ————————————————

describe("SubagentUsageLedger", () => {
  test("a re-delivered child upserts its key instead of adding a second record", () => {
    const ledger = new SubagentUsageLedger();
    assert.equal(ledger.record([childUsage()]), true);
    assert.equal(ledger.record([childUsage()]), false, "identical delivery is not a change");
    assert.equal(ledger.size(), 1);
    // A later, complete delivery of the same child replaces the figure (still one record).
    assert.equal(ledger.record([childUsage({ output: 400 })]), true);
    assert.equal(ledger.size(), 1);
    assert.equal(ledger.records()[0]!.output, 400);
  });

  test("restore reads the LAST subagent-usage entry and ignores malformed payloads", () => {
    assert.deepEqual(
      restoreSubagentUsageRecords([
        subagentUsageEntry([childUsage({ key: "old" })], "e1"),
        { type: "message", id: "e2" },
        subagentUsageEntry([childUsage(), { key: "", input: 5 }, "junk"] as never, "e3"),
      ]),
      [childUsage()],
    );
    assert.deepEqual(restoreSubagentUsageRecords(undefined), []);
    assert.deepEqual(
      restoreSubagentUsageRecords([{ type: "custom", customType: SUBAGENT_USAGE_ENTRY_TYPE }]),
      [],
    );
    assert.deepEqual(lastSubagentUsageRecords([]), []);
  });

  test("R3: a corrupt LAST entry falls through to the previous valid record set", () => {
    const corrupt: unknown[] = [
      { type: "custom", customType: SUBAGENT_USAGE_ENTRY_TYPE, data: "nope" },
      { type: "custom", customType: SUBAGENT_USAGE_ENTRY_TYPE },
      { type: "custom", customType: SUBAGENT_USAGE_ENTRY_TYPE, data: { records: 42 } },
    ];
    for (const entry of corrupt) {
      assert.deepEqual(
        restoreSubagentUsageRecords([subagentUsageEntry([childUsage()], "e1"), entry]),
        [childUsage()],
        JSON.stringify(entry),
      );
    }
    // A well-formed but empty record array is a real (empty) set, not corruption.
    assert.deepEqual(
      restoreSubagentUsageRecords([
        subagentUsageEntry([childUsage()], "e1"),
        subagentUsageEntry([], "e2"),
      ]),
      [],
    );
  });
});

// ———————————————— 3 · 4 · 5 — the totals fold ————————————————

function totalsCtx(entries: unknown[]): never {
  return { sessionManager: { getEntries: () => entries } } as never;
}

function assistantEntry(
  id: string,
  input: number,
  output: number,
  cost: number,
): Record<string, unknown> {
  return {
    type: "message",
    id,
    message: {
      role: "assistant",
      usage: { input, output, cacheRead: 0, cacheWrite: 0, cost: { total: cost } },
    },
  };
}

describe("getUsageTotals — delegated child usage", () => {
  beforeEach(() => invalidateUsageCache());

  test("AC3: child input/output/cache/cost are added to the session totals", () => {
    const totals = getUsageTotals(
      totalsCtx([assistantEntry("a1", 100, 10, 0.001), subagentUsageEntry([childUsage()], "e1")]),
    );
    assert.equal(totals.input, 1_300);
    assert.equal(totals.output, 310);
    assert.equal(totals.cacheRead, 4_000);
    assert.equal(totals.cacheWrite, 100);
    assert.ok(Math.abs(totals.cost - 0.051) < 1e-9, String(totals.cost));
  });

  test("AC5: includeSubagentUsage=false is the parent-only figure", () => {
    const entries = [
      assistantEntry("a1", 100, 10, 0.001),
      subagentUsageEntry([childUsage()], "e1"),
    ];
    const on = getUsageTotals(totalsCtx(entries));
    const off = getUsageTotals(totalsCtx(entries), { includeSubagentUsage: false });
    assert.deepEqual(off, {
      input: 100,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.001,
      // A prompt of 100 uncached tokens is a real 0% hit, not "no cache seen yet".
      latestCacheHitRate: 0,
    });
    assert.notDeepEqual(on, off);
  });

  test("AC4: only the LAST subagent-usage entry counts (cumulative, never summed)", () => {
    const totals = getUsageTotals(
      totalsCtx([
        assistantEntry("a1", 0, 0, 0),
        subagentUsageEntry([childUsage({ key: "run-a#0", input: 10 })], "e1"),
        subagentUsageEntry(
          [childUsage({ key: "run-a#0", input: 10 }), childUsage({ key: "run-b#0", input: 20 })],
          "e2",
        ),
      ]),
    );
    assert.equal(totals.input, 30);
  });

  test("AC4: a record whose parent call pi already counted is dropped (one child, one channel)", () => {
    // pi core copies the tool result's aggregate usage onto the toolResult entry.
    const toolResultEntry = {
      type: "message",
      id: "t1",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        usage: { input: 500, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
      },
    };
    const totals = getUsageTotals(
      totalsCtx([
        toolResultEntry,
        subagentUsageEntry(
          [
            childUsage({
              key: "run-a#0",
              toolCallId: "call-1",
              input: 500,
              output: 50,
              cost: 0.01,
            }),
            childUsage({ key: "run-b#0", input: 7 }),
          ],
          "e1",
        ),
      ]),
      {},
    );
    assert.equal(totals.input, 507, "the covered child is not added twice");
    // 50 from the covered child (counted by its toolResult entry) + the uncovered child's own.
    assert.equal(totals.output, 350);
  });

  test("AC6: no subagent-usage entry → totals are exactly the parent's", () => {
    const entries = [assistantEntry("a1", 100, 10, 0.001)];
    assert.deepEqual(
      getUsageTotals(totalsCtx(entries)),
      getUsageTotals(totalsCtx(entries), { includeSubagentUsage: false }),
    );
  });

  test("malformed records never poison the totals", () => {
    const totals = getUsageTotals(
      totalsCtx([
        assistantEntry("a1", 1, 1, 0),
        {
          type: "custom",
          customType: SUBAGENT_USAGE_ENTRY_TYPE,
          data: { records: [{ input: 999 }] },
          id: "e1",
        },
      ]),
    );
    assert.equal(totals.input, 1);
  });
});

// ———————————————— 5 — display seams ————————————————

describe("R2: the two scopes — session totals fold children, the run row does not", () => {
  // The split is a decision (ADR-0004 rev 3, ADR-0005): the footer answers "what did this
  // session bill?" and folds delegated children; the timeline row answers "how much did this
  // Agent run move?" and keeps the run's own figures. Pinned so it reads as a decision.
  const runTelemetry = {
    tps: 10,
    ttftMs: 500,
    totalMs: 8_000,
    inputTokens: 4_000,
    outputTokens: 800,
    stallMs: 0,
    stallCount: 0,
    rateUsdPerMTokens: null,
    generationMs: 7_000,
    totalTokens: 4_800,
    costUsd: 0.01,
    measurementMs: 7_000,
  };
  const entitlements = [
    {
      type: "message",
      id: "a1",
      message: {
        role: "assistant",
        usage: { input: 4_000, output: 800, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
      },
    },
    subagentUsageEntry(
      [
        childUsage({
          key: "run-a#0",
          input: 1_000,
          output: 250,
          cacheRead: 500,
          cacheWrite: 0,
          cost: 0.125,
        }),
      ],
      "e1",
    ),
  ];

  test("timeline run row keeps Agent-run scope; the footer folds the same session", () => {
    const ledger = new AgentRunLedger(() => 0);
    ledger.startRun(0);
    ledger.recordTurn(runTelemetry);
    // The totals cache keys on entry count + last entry id (known P3), so a sibling test
    // with the same shape can seed it; start from a clean read.
    invalidateUsageCache();
    const totals = getUsageTotals(totalsCtx(entitlements));
    const line = buildTimelineText({
      // What the orchestrator hands over at agent_settled: the run's own settled figures.
      effectiveTel: runTelemetry,
      totals,
      ctxTokens: 1_000_000,
      snap: {
        phase: "settled",
        turnNumber: 1,
        activeTools: 0,
        completedCount: 0,
        failedCount: 0,
      },
      config: { ...structuredClone(DEFAULT_CONFIG), icons: { mode: "ascii" } },
      lastDoneIn: 8_000,
      now: new Date("2026-08-25T10:00:00Z"),
      ledger,
    });

    // Run row: the run's own 4 000 / 800 / $0.01 — never the folded session figures.
    assert.ok(line.includes("↑ 4.0k"), line);
    assert.ok(line.includes("↓ 800"), line);
    assert.ok(line.includes("$0.01"), line);
    assert.ok(!line.includes("5.0k"), `folded session input leaked into the run row: ${line}`);
    assert.ok(!line.includes("$0.14"), `folded session cost leaked into the run row: ${line}`);

    // Footer, same session: children folded (4 000 + 1 000 + 500 cache-read, 800 + 250, 0.01 + 0.125).
    let captured: { render(width: number): string[] } | undefined;
    installFooter(
      {
        ui: {
          setWidget: (_key: string, content: unknown) => {
            captured = typeof content === "function" ? (content() as typeof captured) : undefined;
          },
        },
        sessionManager: {
          getCwd: () => "/tmp",
          getEntries: () => entitlements,
          getSessionName: () => undefined,
        },
        model: { provider: "p", id: "m" },
        getContextUsage: () => undefined,
      } as never,
      () => createInitialState(),
      () => ({ ...structuredClone(DEFAULT_CONFIG), icons: { mode: "ascii" } }),
      () => ({ provider: "p", model: "m", effort: undefined }),
      { setRequestRender: () => {}, scheduleGitRefresh: () => {} },
    );
    assert.ok(captured, "the fallback widget renderer must be installed");
    const footer = captured!.render(160)[0] ?? "";
    assert.ok(footer.includes("↑ 5.5k"), footer);
    assert.ok(footer.includes("↓ 1.1k"), footer);
    assert.ok(footer.includes("$0.14"), footer);
  });
});

describe("display seams honour the subagentUsage toggle", () => {
  test("footer: ↑/↓/$ include child usage, and toggle off is the parent-only line", () => {
    const entries = [
      {
        type: "message",
        id: "a2",
        message: {
          role: "assistant",
          usage: { input: 395, output: 505, cacheRead: 0, cacheWrite: 0, cost: { total: 0.16 } },
        },
      },
      subagentUsageEntry(
        [
          childUsage({
            key: "run-a#0",
            input: 1_000,
            output: 500,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0.25,
          }),
        ],
        "e1",
      ),
    ];

    /** The production seam: installFooter renders through getUsageTotals + the config. */
    const footerLine = (subagentUsage: boolean): string => {
      invalidateUsageCache();
      const config: ThemeConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        subagentUsage,
        icons: { mode: "ascii" },
      };
      let captured: { render(width: number): string[] } | undefined;
      const ctx = {
        ui: {
          setWidget: (_key: string, content: unknown) => {
            captured = typeof content === "function" ? (content() as typeof captured) : undefined;
          },
        },
        sessionManager: {
          getCwd: () => "/tmp",
          getEntries: () => entries,
          getSessionName: () => undefined,
        },
        model: { provider: "p", id: "m" },
        getContextUsage: () => undefined,
      };
      installFooter(
        ctx as never,
        () => createInitialState(),
        () => config,
        () => ({ provider: "p", model: "m", effort: undefined }),
        { setRequestRender: () => {}, scheduleGitRefresh: () => {} },
      );
      assert.ok(captured, "the fallback widget renderer must be installed");
      return captured!.render(160)[0] ?? "";
    };

    const on = footerLine(true);
    const off = footerLine(false);
    assert.ok(on.includes("↑ 1.4k"), on);
    assert.ok(on.includes("↓ 1.0k"), on);
    assert.ok(on.includes("$0.41"), on);
    // Toggle off: byte-identical to a session whose entries carry no child records.
    assert.ok(off.includes("↑ 395"), off);
    assert.ok(off.includes("↓ 505"), off);
    assert.ok(off.includes("$0.16"), off);
    assert.ok(!off.includes("↑ 1.4k"), off);
  });

  test("live border asks the accumulator for the figure the toggle selects", () => {
    const seen: boolean[] = [];
    const cfg: ThemeConfig = { ...structuredClone(DEFAULT_CONFIG), icons: { mode: "ascii" } };
    const render = (): void => {
      const deps = {
        getEditor: () => ({ setChrome: () => {} }) as never,
        getCtx: () =>
          ({
            mode: "tui",
            ui: { theme: identityTheme },
            sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
            getContextUsage: () => undefined,
            model: { provider: "p", id: "m", contextWindow: 200_000 },
            thinkingLevel: "off",
          }) as never,
        getConfig: () => cfg,
        telemetryTracker: { peekLive: () => null, getLastTelemetry: () => null } as never,
        runActivityTracker: { getSnapshot: () => undefined, isRunning: () => false } as never,
        agentLedger: new AgentRunLedger(),
        getSessionRunTime: (includeSubagent: boolean) => {
          seen.push(includeSubagent);
          return { totalMs: 8_000, running: false };
        },
      };
      new LiveBorder(deps).render();
    };
    render();
    cfg.subagentUsage = false;
    render();
    assert.deepEqual(seen, [true, false]);
  });
});

// ———————————————— 1 · 2 · 3 · 4 · 6 — the orchestrator integration ————————————————

describe("SessionOrchestrator — delegated work", () => {
  let clock: ReturnType<typeof useClock>;
  beforeEach(() => {
    clock = useClock();
  });
  afterEach(() => {
    while (createdOrchestrators.length > 0) createdOrchestrators.pop()?.dispose();
    clock?.restore();
  });

  test("AC2 · AC3: a background child extends the run time and reports its usage", () => {
    const { orch } = orchestratorWithStubs();
    const bus = fakeEventBus();
    const raw = fakePi({ events: bus.bus });
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);

    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(4_000);
    fire(raw, "agent_settled", {}, ctx); // parent ran 4s

    clock.set(10_000);
    bus.emit("subagent:async-started", { runId: "run-b", agent: "worker", mode: "single" });
    clock.set(25_000); // 15s of child-only time
    bus.emit(
      "subagent:async-complete",
      asyncComplete("run-b", { input: 700, output: 90, cacheRead: 60, cacheWrite: 0, cost: 0.004 }),
    );

    assert.equal(orch.getSessionRunTime().settled(), 19_000);
    const usageEntries = raw.appended.filter((a) => a.type === SUBAGENT_USAGE_ENTRY_TYPE);
    assert.deepEqual(usageEntries.at(-1)?.data, {
      records: [
        { key: "run-b#0", input: 700, output: 90, cacheRead: 60, cacheWrite: 0, cost: 0.004 },
      ],
    });
    const timeEntries = raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE);
    // Both scopes: 19 s inclusive (4 s parent ∪ 15 s child), 4 s parent-only.
    assert.deepEqual(timeEntries.at(-1)?.data, { seconds: 19, parentSeconds: 4 });
  });

  test("AC1: a foreground delegation does not move the run time, but reports usage", () => {
    const { orch } = orchestratorWithStubs();
    const bus = fakeEventBus();
    const raw = fakePi({ events: bus.bus });
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);

    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(3_000);
    fire(
      raw,
      "tool_execution_end",
      {
        toolCallId: "call-1",
        toolName: "subagent",
        isError: false,
        result: foregroundResult({
          toolCallId: "call-1",
          children: [{ input: 40, output: 8, cost: 0.002 }],
        }),
      },
      ctx,
    );
    clock.set(6_000);
    fire(raw, "agent_settled", {}, ctx);

    assert.equal(
      orch.getSessionRunTime().settled(),
      6_000,
      "the child window is inside the parent run",
    );
    const usageEntries = raw.appended.filter((a) => a.type === SUBAGENT_USAGE_ENTRY_TYPE);
    assert.equal(usageEntries.length, 1);
    assert.deepEqual((usageEntries[0]!.data as { records: SubagentUsageRecord[] }).records, [
      {
        key: "call-1#0",
        toolCallId: "call-1",
        input: 40,
        output: 8,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.002,
      },
    ]);
  });

  test("AC4: a resumed session restores child time and usage, counted once", () => {
    const { orch } = orchestratorWithStubs();
    const bus = fakeEventBus();
    const raw = fakePi({ events: bus.bus });
    orch.install(raw as never);
    const history = [
      runTimeEntry(60, "e1"),
      subagentUsageEntry([childUsage({ key: "run-a#0", input: 1_200 })], "e2"),
    ];
    fire(raw, "session_start", {}, fakeCtx(history));
    assert.equal(orch.getSessionRunTime().settled(), 60_000);

    // A second child completes in the resumed session: the entry carries BOTH records.
    clock.set(5_000);
    bus.emit(
      "subagent:async-complete",
      asyncComplete("run-b", { input: 10, output: 1, cost: 0.001 }),
    );
    const appendedUsage = raw.appended.filter((a) => a.type === SUBAGENT_USAGE_ENTRY_TYPE);
    assert.deepEqual((appendedUsage.at(-1)!.data as { records: SubagentUsageRecord[] }).records, [
      childUsage({ key: "run-a#0", input: 1_200 }),
      { key: "run-b#0", input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.001 },
    ]);
    // No interval was opened for the restored 60s, so settling again cannot double it.
    clock.set(8_000);
    fire(raw, "agent_start", {}, fakeCtx(history));
    clock.set(10_000);
    fire(raw, "agent_settled", {}, fakeCtx(history));
    assert.equal(orch.getSessionRunTime().settled(), 62_000);

    // And the totals over the resumed history include each child exactly once.
    invalidateUsageCache();
    const totals = getUsageTotals(
      totalsCtx([
        ...history,
        ...appendedUsage.map((a) => ({ type: "custom", customType: a.type, data: a.data })),
      ]),
    );
    assert.equal(totals.input, 1_210);
    assert.equal(totals.output, 301);
  });

  test("R1: a resumed session's toggle-off figure is parent-only", () => {
    const { orch } = orchestratorWithStubs();
    const raw = fakePi({ events: fakeEventBus().bus });
    orch.install(raw as never);
    // Both scopes persist: 100 s inclusive, 60 s parent-only.
    const history = [
      {
        type: "custom",
        customType: SESSION_RUN_TIME_ENTRY_TYPE,
        data: { seconds: 100, parentSeconds: 60 },
        id: "e1",
      },
    ];
    fire(raw, "session_start", {}, fakeCtx(history));
    const acc = orch.getSessionRunTime();
    assert.equal(acc.snapshot(5_000).totalMs, 100_000);
    assert.equal(
      acc.snapshot(5_000, { includeSubagent: false }).totalMs,
      60_000,
      "toggle-off after resume must not inherit the child windows",
    );

    // A legacy entry (no parent figure) cannot be split; the fallback is documented.
    const legacy = orchestratorWithStubs();
    const rawLegacy = fakePi({ events: fakeEventBus().bus });
    legacy.orch.install(rawLegacy as never);
    fire(rawLegacy, "session_start", {}, fakeCtx([runTimeEntry(100, "e1")]));
    assert.equal(
      legacy.orch.getSessionRunTime().snapshot(5_000, { includeSubagent: false }).totalMs,
      100_000,
    );
  });

  test("AC6: a pi without an event bus keeps parent figures and never throws", () => {
    const { orch } = orchestratorWithStubs();
    const raw = fakePi(); // no `events` member at all — the extension is absent
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);
    clock.set(0);
    fire(raw, "agent_start", {}, ctx);
    clock.set(2_500);
    fire(raw, "agent_settled", {}, ctx);

    assert.equal(orch.getSessionRunTime().settled(), 2_500);
    assert.equal(orch.getSessionRunTime().snapshot(3_000).totalMs, 2_500);
    assert.deepEqual(
      raw.appended.filter((a) => a.type === SESSION_RUN_TIME_ENTRY_TYPE),
      [{ type: SESSION_RUN_TIME_ENTRY_TYPE, data: { seconds: 2, parentSeconds: 2 } }],
    );
    assert.deepEqual(
      raw.appended.filter((a) => a.type === SUBAGENT_USAGE_ENTRY_TYPE),
      [],
      "no delegated usage was ever reported",
    );
  });

  test("AC6: junk event payloads change nothing", () => {
    const { orch } = orchestratorWithStubs();
    const bus = fakeEventBus();
    const raw = fakePi({ events: bus.bus });
    orch.install(raw as never);
    const ctx = fakeCtx([]);
    fire(raw, "session_start", {}, ctx);

    bus.emit("subagent:async-started", undefined);
    bus.emit("subagent:async-complete", "nonsense");
    bus.emit("subagent:async-complete", { results: [] });

    assert.equal(orch.getSessionRunTime().settled(), 0);
    assert.deepEqual(raw.appended, []);
  });

  test("dispose unsubscribes from the event bus (no listener leak across sessions)", () => {
    const { orch } = orchestratorWithStubs();
    const bus = fakeEventBus();
    const raw = fakePi({ events: bus.bus });
    orch.install(raw as never);
    fire(raw, "session_start", {}, fakeCtx([]));
    assert.equal(bus.listeners("subagent:async-complete"), 1);
    orch.dispose();
    assert.equal(bus.listeners("subagent:async-complete"), 0);
  });
});
