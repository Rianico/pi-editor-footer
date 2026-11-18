/**
 * `/cache graph` and `/cache stats` declare OSC 7501 program status while their overlay
 * waits for a keypress: pi 1.5.1+ honours `blocked` on overlays until `done()` (also while
 * hidden), so a terminal or an agent dashboard sees a question instead of an idle pi.
 * pi < 1.5 ignores the option, so the `*` peer range stays compatible.
 *
 * These pin the options argument only — the dialog factory is never invoked, so TUI
 * rendering stays the cache-graph/cache-stats suites' business.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { registerCacheCommand } from "../src/cache-command.js";

interface CapturedOpen {
  options: unknown;
  factory: unknown;
}

interface Harness {
  opens: CapturedOpen[];
  notices: string[];
  run: (args: string) => Promise<void>;
}

function harness(): Harness {
  const opens: CapturedOpen[] = [];
  const notices: string[] = [];
  let handler: ((args: string, ctx: unknown) => void | Promise<void>) | undefined;

  const pi = {
    registerCommand(
      _name: string,
      options: { handler: (args: string, ctx: unknown) => void | Promise<void> },
    ): void {
      handler = options.handler;
    },
  };
  const ctx = {
    hasUI: true,
    cwd: "/tmp",
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
      getSessionName: () => "test",
      getSessionFile: () => "/tmp/session.jsonl",
    },
    ui: {
      notify(message: string): void {
        notices.push(message);
      },
      custom(factory: unknown, options?: unknown): Promise<undefined> {
        opens.push({ options, factory });
        return Promise.resolve(undefined);
      },
    },
  };

  registerCacheCommand(pi as never, { getConfig: () => ({ icons: { mode: "ascii" } }) });
  assert.ok(handler, "the /cache command must register exactly one handler");
  const registered: (args: string, ctx: unknown) => void | Promise<void> = handler;
  return {
    opens,
    notices,
    run: async (args) => {
      await registered(args, ctx);
    },
  };
}

describe("/cache overlays report a blocked program status", () => {
  test("graph declares a question with its dialog title", async () => {
    const h = harness();
    await h.run("graph");
    assert.equal(h.opens.length, 1);
    assert.deepEqual(h.opens[0]!.options, {
      overlay: true,
      overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%", margin: 1 },
      blocked: { kind: "question", message: "Context Cache Graph" },
    });
  });

  test("stats declares a question with its dialog title", async () => {
    const h = harness();
    await h.run("stats");
    assert.equal(h.opens.length, 1);
    const options = h.opens[0]!.options as Record<string, unknown>;
    assert.equal(options.overlay, true);
    assert.deepEqual(options.blocked, { kind: "question", message: "Context Cache Stats" });
  });

  test("a second open passes a fresh option object, never a stale status", async () => {
    const h = harness();
    await h.run("graph");
    await h.run("stats");
    assert.equal(h.opens.length, 2);
    const first = h.opens[0]!.options as Record<string, unknown>;
    const second = h.opens[1]!.options as Record<string, unknown>;
    assert.notEqual(first, second, "each open builds its own options object");
    assert.deepEqual(first.blocked, { kind: "question", message: "Context Cache Graph" });
    assert.deepEqual(second.blocked, { kind: "question", message: "Context Cache Stats" });
  });

  test("an unknown subcommand opens no overlay and still notifies usage", async () => {
    const h = harness();
    await h.run("nope");
    assert.equal(h.opens.length, 0);
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0]!, /Usage: \/cache graph \| \/cache stats \| \/cache export/);
  });
});
