import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SessionOrchestrator } from "../src/session-orchestrator.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createInitialState } from "../src/state.js";

function fakePi() {
  const handlers = new Map<string, ((e: unknown, ctx: unknown) => void)[]>();
  const commands = new Map<string, unknown>();
  const shortcuts = new Map<string, unknown>();
  return {
    handlers,
    commands,
    shortcuts,
    on(event: string, handler: (e: unknown, ctx: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, opts: unknown) {
      commands.set(name, opts);
    },
    registerShortcut(name: string, opts: unknown) {
      shortcuts.set(name, opts);
    },
  };
}

function fakeCtx(over: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    ui: {
      setEditorComponent: () => {},
      setWidget: () => {},
      theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
      notify: () => {},
    },
    model: { provider: "test", id: "model", contextWindow: 100000 },
    thinkingLevel: "off",
    ...over,
  };
}

describe("SessionOrchestrator", () => {
  test("install registers session and model handlers", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
    });
    const raw = fakePi();
    const pi = raw as unknown as Parameters<SessionOrchestrator["install"]>[0];
    orch.install(pi);
    assert.ok(raw.handlers.has("session_start"), "session_start registered");
    assert.ok(raw.handlers.has("session_shutdown"), "session_shutdown registered");
    assert.ok(raw.handlers.has("agent_start"), "agent_start registered");
    assert.ok(raw.handlers.has("agent_settled"), "agent_settled registered");
    assert.ok(raw.commands.has("model-info"), "model-info command registered");
  });

  test("git rail clock: armed with the footer, nudged by the run settling, stopped on dispose", () => {
    const calls = { start: 0, request: 0, stop: 0 };
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
      // Without this seam every read spawns real git in the session cwd.
      createGitRefresher: () => ({
        start: () => {
          calls.start++;
        },
        request: () => {
          calls.request++;
        },
        stop: () => {
          calls.stop++;
        },
      }),
    });
    const raw = fakePi();
    const pi = raw as unknown as Parameters<SessionOrchestrator["install"]>[0];
    orch.install(pi);
    const fire = (name: string, e: unknown): void => {
      for (const h of raw.handlers.get(name) ?? []) h(e, fakeCtx() as never);
    };

    fire("session_start", {});
    assert.equal(calls.start, 1, "the rail clock is armed with the footer");

    fire("tool_execution_end", { toolCallId: "t1", result: { content: [] } });
    assert.equal(calls.request, 0, "per-tool refreshes are deliberately not wired");

    fire("agent_settled", {});
    assert.equal(calls.request, 1, "a settled run refreshes the rail");

    fire("agent_settled", { aborted: true });
    assert.equal(calls.request, 2, "an aborted run settles too, so it refreshes too");

    orch.dispose();
    assert.equal(calls.stop, 1, "dispose stops the poll");
  });

  test("detailChrome seam is accessible and hasContent reflects item", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
    });
    const chrome = orch.getDetailChrome();
    assert.equal(chrome.hasContent(), false);
    chrome.setItem({ label: "test", value: "test", description: "hello" } as never);
    assert.equal(chrome.hasContent(), true);
    assert.equal(chrome.getScrollOffset(), 0);
    chrome.scrollBy(1);
    // scrollBy is clamped when content fits, so offset stays 0
    assert.equal(chrome.getScrollOffset(), 0);
  });

  test("getConfig returns loaded config and getFooterState is initial", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => ({ ...structuredClone(DEFAULT_CONFIG), cursorStyle: "bar" }),
      createInitialState: () => createInitialState(),
    });
    assert.equal(orch.getConfig().cursorStyle, "bar");
    const state = orch.getFooterState();
    assert.ok(state !== null);
    assert.equal(typeof state.git, "object");
  });

  test("dispose clears timers and state without throwing", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
    });
    const raw = fakePi();
    const pi = raw as unknown as Parameters<SessionOrchestrator["install"]>[0];
    orch.install(pi);
    // simulate session_start to arm watchdog
    const ctx = fakeCtx();
    const startHandlers = raw.handlers.get("session_start") ?? [];
    for (const h of startHandlers) h({}, ctx as never);
    assert.ok(orch.getTuiRef() === null || orch.getTuiRef() !== undefined);
    orch.dispose();
    assert.equal(orch.getTuiRef(), null);
    // second dispose should not throw
    orch.dispose();
  });

  test("liveBorder and agentLedger are accessible via seam", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
    });
    assert.ok(orch.getLiveBorder() !== null);
    assert.ok(orch.getAgentLedger() !== null);
    assert.equal(typeof orch.getLiveBorder().render, "function");
  });

  test("live wiring: anchor reaches tracker, delta bursts coalesce to one render", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
    });
    const raw = fakePi();
    const pi = raw as unknown as Parameters<SessionOrchestrator["install"]>[0];
    orch.install(pi);
    const fire = (name: string, e: unknown): void => {
      for (const h of raw.handlers.get(name) ?? []) h(e, fakeCtx() as never);
    };
    // count coalescer pass-throughs (doRender), not render() calls: the rate
    // cap lives inside LiveBorder.render, so only doRender proves it holds.
    const lb = orch.getLiveBorder();
    let renders = 0;
    const lbDoRender = lb as unknown as { doRender: () => void };
    const origDoRender = lbDoRender.doRender.bind(lb);
    lbDoRender.doRender = () => {
      renders++;
      origDoRender();
    };
    const msg = {
      role: "assistant",
      content: [],
      usage: {
        input: 10,
        output: 6,
        totalTokens: 16,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    // Phase 1 (rate): burst of deltas with no turn active. Tracker no-ops
    // safely; all 10 fires must coalesce into exactly ONE render — this
    // asserts the LiveBorder rate cap end-to-end (review #9), not the call.
    // Deterministic: border is fresh (lastRenderMs 0), burst runs in one ms.
    const burstStart = renders;
    for (let i = 0; i < 10; i++) {
      fire("message_update", {
        type: "message_update",
        message: msg,
        assistantMessageEvent: { type: "text_delta", delta: "hi" },
      });
    }
    assert.equal(renders, burstStart + 1);
    // Phase 2 (anchor/output): real turn; provider usage + anchor reach the tracker.
    fire("turn_start", { type: "turn_start", turnIndex: 0 });
    fire("before_provider_request", { type: "before_provider_request" });
    fire("message_start", { type: "message_start", message: msg });
    // 2 chars -> chars/4 gives 1; provider reports exact 6
    fire("message_update", {
      type: "message_update",
      message: msg,
      assistantMessageEvent: { type: "text_delta", delta: "hi", partial: { usage: { output: 6 } } },
    });
    const live = orch.getTelemetryTracker().peekLive();
    assert.ok(live, "expected live telemetry while streaming");
    assert.equal(live!.outputTokens, 6);
    assert.ok((live!.ttftProviderMs ?? -1) >= 0, "provider anchor must reach the tracker");
    orch.dispose();
  });

  test("delta tokens: captured from the run at settle, reset at the next run, cleared on dispose", () => {
    const orch = new SessionOrchestrator({
      loadConfig: () => structuredClone(DEFAULT_CONFIG),
      createInitialState: () => createInitialState(),
      createGitRefresher: () => ({ start: () => {}, request: () => {}, stop: () => {} }),
    });
    const raw = fakePi();
    const pi = raw as unknown as Parameters<SessionOrchestrator["install"]>[0];
    orch.install(pi);
    const ledger = orch.getAgentLedger();
    // A resumed Pi session: history carries a large billed prompt the very first
    // render must NOT show — the row is run-scoped, so it starts absent.
    const resumed = [
      { type: "message", id: "m1", message: { role: "user", content: "hello there" } },
      {
        type: "message",
        id: "m2",
        message: {
          role: "assistant",
          usage: { input: 300000, cacheRead: 50000, output: 800, totalTokens: 350800 },
        },
      },
    ];
    const ctx = fakeCtx({
      sessionManager: { getEntries: () => resumed },
      getContextUsage: () => ({ tokens: 120000, contextWindow: 1000000 }),
    });
    const fire = (name: string, e: unknown): void => {
      for (const h of raw.handlers.get(name) ?? []) h(e, ctx as never);
    };
    assert.equal(ledger.getAtRestTotals(), null, "no first run → no delta row");

    const msg = {
      role: "assistant",
      content: [],
      usage: {
        input: 42000,
        output: 900,
        totalTokens: 42900,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const runOneTurn = (): void => {
      fire("agent_start", { type: "agent_start" });
      fire("turn_start", { type: "turn_start", turnIndex: 0 });
      fire("message_start", { type: "message_start", message: msg });
      fire("message_end", { type: "message_end", message: msg });
      fire("turn_end", { type: "turn_end", turnIndex: 0 });
      fire("agent_settled", { type: "agent_settled" });
    };
    runOneTurn();
    const atRest = ledger.getAtRestTotals();
    assert.ok(atRest, "settle keeps the run's delta tokens");
    assert.equal(atRest.inputTokens, 42000, "the run's prompt, not the 350k session total");
    assert.equal(atRest.outputTokens, 900);
    assert.equal(atRest.estimated, false, "authoritative at rest — no ~");

    fire("agent_start", { type: "agent_start" });
    assert.equal(ledger.getAtRestTotals(), null, "the next run resets the pair");

    // aborted mid-turn: turn_start with no turn_end, so the run completes no turn
    fire("turn_start", { type: "turn_start", turnIndex: 0 });
    fire("message_start", { type: "message_start", message: msg });
    fire("message_update", {
      type: "message_update",
      message: msg,
      assistantMessageEvent: { type: "text_delta", delta: "aborted mid-answer" },
    });
    fire("agent_settled", { type: "agent_settled", aborted: true });
    const aborted = ledger.getAtRestTotals();
    assert.ok(aborted, "an aborted run keeps a readout too");
    assert.equal(aborted.estimated, true, "no completed turn → still the live estimate, still ~");
    assert.ok(aborted.outputTokens > 0, "the unfinished turn's live delta is kept");

    orch.dispose();
    assert.equal(ledger.getAtRestTotals(), null, "session shutdown clears the ledger");
  });
});
