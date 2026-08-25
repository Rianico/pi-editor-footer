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
});
