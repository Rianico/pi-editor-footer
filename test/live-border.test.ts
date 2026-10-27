/**
 * LiveBorder.render characterization (C3).
 *
 * The live render path is pure structure — rendered bytes must not drift. These
 * tests pin, per scenario: exactly ONE editor.setChrome per refresh (coalesced
 * draw), the merged field values, and the early-return branches (telemetry
 * off/on, stalls, context on/off, idle vs running).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LiveBorder, type LiveBorderDeps } from "../src/live-border.js";
import { DEFAULT_CONFIG, type ThemeConfig } from "../src/config.js";
import { stripAnsi } from "../src/format.js";
import type { SessionRunTimeSnapshot } from "../src/session-run-time.js";
import type { TurnTelemetry } from "../src/telemetry.js";
import { AgentRunLedger } from "../src/agent-run-ledger.js";
import type { RunActivitySnapshot } from "../src/run-activity.js";
import { TrackingEditor, type ChromeSnapshot } from "../src/tracking-editor.js";
import { rowsPrependedAboveEditor } from "../src/border-renderer.js";

function tel(over: Partial<TurnTelemetry> = {}): TurnTelemetry {
  return {
    tps: 12.5,
    ttftMs: 1234,
    totalMs: 20000,
    inputTokens: 4321,
    outputTokens: 876,
    stallMs: 0,
    stallCount: 0,
    rateUsdPerMTokens: null,
    generationMs: 15000,
    totalTokens: 5197,
    costUsd: 0.12,
    measurementMs: 15000,
    ...over,
  };
}

function idleSnap(over: Partial<RunActivitySnapshot> = {}): RunActivitySnapshot {
  return { phase: "idle", activeTools: 0, completedCount: 0, failedCount: 0, ...over };
}

interface Harness {
  calls: Array<Partial<ChromeSnapshot>>;
  merged: Partial<ChromeSnapshot>;
  deps: LiveBorderDeps;
}

function harness(
  over: {
    config?: (c: ThemeConfig) => void;
    peekLive?: TurnTelemetry | null;
    lastTel?: TurnTelemetry | null;
    ledgerLive?: TurnTelemetry | null;
    runSnap?: RunActivitySnapshot;
    isRunning?: boolean;
    atRest?: TurnTelemetry | null;
    atRestThrows?: boolean;
    ledger?: unknown;
    incDisplay?: TurnTelemetry | null;
    runTime?: SessionRunTimeSnapshot;
    noEditor?: boolean;
    noCtx?: boolean;
  } = {},
): Harness {
  const calls: Array<Partial<ChromeSnapshot>> = [];
  const merged: Partial<ChromeSnapshot> = {};
  const editor = {
    setChrome(patch: Partial<ChromeSnapshot>) {
      calls.push({ ...patch });
      Object.assign(merged, patch);
    },
  };
  const cfg = structuredClone(DEFAULT_CONFIG);
  // deterministic glyphs regardless of the host terminal (auto would follow TERM_PROGRAM)
  cfg.icons.mode = "ascii";
  over.config?.(cfg);
  const ctx = {
    mode: "tui",
    ui: {
      // identity fg keeps assertions on structure + text; hex tiers still emit SGR,
      // which stripAnsi removes
      theme: { fg: (_c: string, s: string) => s, getColorMode: () => "truecolor" },
      setEditorComponent: () => {},
      setWidget: () => {},
      notify: () => {},
    },
    sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
    getContextUsage: () => ({ percent: 50, tokens: 512000, contextWindow: 1000000 }),
    model: { provider: "p", id: "m", contextWindow: 1000000 },
    thinkingLevel: "off",
  };
  return {
    calls,
    merged,
    deps: {
      getEditor: () => (over.noEditor ? null : (editor as never)),
      getCtx: () => (over.noCtx ? null : (ctx as never)),
      getConfig: () => cfg,
      telemetryTracker: {
        peekLive: () => over.peekLive ?? null,
        getLastTelemetry: () => over.lastTel ?? null,
      } as never,
      runActivityTracker: {
        getSnapshot: () => over.runSnap ?? idleSnap(),
        isRunning: () => over.isRunning ?? false,
      } as never,
      // undefined option → plausible display; explicit null pins the throw/skip branch
      agentLedger: (over.ledger ?? {
        getLiveTotals: () => over.ledgerLive ?? null,
        getAtRestTotals: () => {
          if (over.atRestThrows) throw new Error("ledger boom");
          return "atRest" in over ? over.atRest! : tel();
        },
        getIncrementalLiveDisplayTotals: () => ("incDisplay" in over ? over.incDisplay : tel()),
      }) as never,
      getSessionRunTime: () => over.runTime ?? null,
    },
  };
}

function renderOnce(h: Harness): void {
  // fresh LiveBorder per scenario: lastRenderMs 0 → render() is never throttled
  new LiveBorder(h.deps).render();
}

/** Identity theme + a real editor, so the rendered row (not just the fields) is asserted. */
const identity = (s: string): string => s;
const liveTheme = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => identity,
  fg: (_style: string, s: string) => s,
  bold: identity,
  dim: identity,
  muted: identity,
};
const editorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
const tui = {
  requestRender: () => {},
  setShowHardwareCursor: () => {},
  terminal: { rows: 24, columns: 80, write: () => {} },
};

/** The one patch as a real editor renders it — prepend rows and status slot included. */
function renderThroughEditor(chrome: Partial<ChromeSnapshot>): string[] {
  const editor = new TrackingEditor(
    tui as never,
    editorTheme as never,
    { matches: () => false },
    () => liveTheme as never,
  );
  editor.setChrome(chrome);
  return editor.render(80);
}
describe("LiveBorder.render — coalesced draw", () => {
  test("one setChrome per refresh carries every field", () => {
    const h = harness({ peekLive: tel({ totalMs: 5000 }), isRunning: true });
    renderOnce(h);
    assert.equal(h.calls.length, 1, `expected 1 setChrome, got ${h.calls.length}`);
    assert.deepEqual(Object.keys(h.calls[0]!).sort(), [
      "bottomLeftText",
      "telemetryText",
      "topContextText",
      "topRightText",
      "topRunTimeText",
      "topStallText",
      "topTokensText",
    ]);
  });

  test("no editor or no ctx → no setChrome at all", () => {
    const noEditor = harness({ noEditor: true });
    renderOnce(noEditor);
    assert.equal(noEditor.calls.length, 0);
    const noCtx = harness({ noCtx: true });
    renderOnce(noCtx);
    assert.equal(noCtx.calls.length, 0);
  });

  test("a throwing ledger island still delivers the other islands' fields in the one patch", () => {
    // a throwing at-rest read makes formatTelemetryTokens throw inside the context
    // island — same as before coalescing, top/telemetry fields still land.
    const h = harness({ atRestThrows: true });
    renderOnce(h);
    assert.equal(h.calls.length, 1);
    assert.ok("topRightText" in h.merged);
    assert.ok(!("topContextText" in h.merged), "context island threw → field not patched");
  });
});

describe("LiveBorder.render — field branches", () => {
  test("telemetry disabled clears bottom, keeps context", () => {
    const h = harness({ config: (c) => void (c.telemetry.enabled = false) });
    renderOnce(h);
    assert.equal(h.calls.length, 1);
    assert.equal(h.merged.telemetryText, "");
    assert.equal(h.merged.bottomLeftText, "");
    assert.equal(h.merged.topTokensText, "");
    assert.ok(h.merged.topContextText!.includes("50.0%"));
  });

  test("no live and no last telemetry → bottom fields untouched", () => {
    const h = harness();
    renderOnce(h);
    assert.equal(h.calls.length, 1);
    assert.ok(!("telemetryText" in h.merged));
    assert.ok(!("bottomLeftText" in h.merged));
  });

  test("live with totalMs 0 suppresses bottom telemetry", () => {
    const h = harness({ peekLive: tel({ totalMs: 0 }) });
    renderOnce(h);
    assert.ok(!("telemetryText" in h.merged));
  });

  test("bottom telemetry carries TPS/TTFT bytes", () => {
    const h = harness({ peekLive: tel({ totalMs: 5000 }), isRunning: true });
    renderOnce(h);
    const plain = stripAnsi(h.merged.telemetryText!);
    assert.ok(plain.includes("tok/s TPS"));
    assert.ok(plain.includes("TTFT"));
  });

  test("stall is its own field, never another section of the run activity", () => {
    const h = harness({
      ledgerLive: tel({ stallMs: 1500, stallCount: 2 }),
      runSnap: idleSnap({ phase: "running", turnNumber: 2, durationMs: 12345 }),
    });
    renderOnce(h);
    const activity = stripAnsi(h.merged.topRightText!);
    assert.ok(activity.includes("2 turns"), activity);
    assert.ok(!activity.includes("1.5s"), "a condition is not glued to the activity field");
    assert.ok(!activity.includes("|"), activity);
    const stall = stripAnsi(h.merged.topStallText!);
    assert.ok(stall.includes("!2×1.5s"), stall);
  });

  test("no stall → no stall field", () => {
    const h = harness({ runSnap: idleSnap({ phase: "running", turnNumber: 2 }) });
    renderOnce(h);
    assert.equal(h.merged.topStallText, "");
  });

  test("a stall is reported only while the current run is actually stalled", () => {
    // Run 1 stalls and settles; run 2 starts healthy with no turn yet. The stall is a
    // live condition, so run 1's `!2×` must not be inherited — not even though the
    // telemetry tracker still holds run 1's figures (it resets only on model select).
    const settled = new AgentRunLedger(() => 9000);
    settled.startRun(0);
    settled.recordTurn(tel({ stallMs: 3300, stallCount: 2 }));
    settled.settleRun(null, 1_000_000);
    settled.startRun(9000);
    const fresh = harness({
      ledger: settled,
      lastTel: tel({ stallMs: 3300, stallCount: 2 }),
      runSnap: idleSnap({ phase: "running" }),
      isRunning: true,
    });
    renderOnce(fresh);
    assert.equal(fresh.merged.topStallText, "", "run 2 has no stall of its own yet");

    // The same run's own stall does render once it has one, so the rule above is
    // "live-only", not "a field that can never appear".
    const stalledLedger = new AgentRunLedger(() => 9000);
    stalledLedger.startRun(0);
    stalledLedger.recordTurn(tel({ stallMs: 3300, stallCount: 2 }));
    const stalled = harness({
      ledger: stalledLedger,
      lastTel: null,
      runSnap: idleSnap({ phase: "running" }),
      isRunning: true,
    });
    renderOnce(stalled);
    assert.ok(stripAnsi(stalled.merged.topStallText!).includes("!2×3.3s"));
  });

  test("stall suppressed when telemetry.stalls off, still bottom-clean", () => {
    const h = harness({
      config: (c) => void (c.telemetry.stalls = false),
      ledgerLive: tel({ stallMs: 1500, stallCount: 2 }),
    });
    renderOnce(h);
    assert.equal(h.merged.topStallText, "");
    assert.ok(!stripAnsi(h.merged.topRightText ?? "").includes("1.5s"));
  });

  test("context segment off → empty topContextText", () => {
    const h = harness({ config: (c) => void (c.footerSegments.context = false) });
    renderOnce(h);
    assert.equal(h.merged.topContextText, "");
  });

  test("icon bar off by default, on when contextIconBar true", () => {
    const off = harness();
    renderOnce(off);
    assert.ok(!stripAnsi(off.merged.topContextText!).includes("["));
    const on = harness({ config: (c) => void (c.contextIconBar = true) });
    renderOnce(on);
    assert.ok(stripAnsi(on.merged.topContextText!).includes("[#####-----]"));
  });

  test("idle tokens are the last run's authoritative delta (no ~)", () => {
    const h = harness({ atRest: tel({ inputTokens: 3000, outputTokens: 400 }) });
    renderOnce(h);
    const plain = stripAnsi(h.merged.topTokensText!);
    assert.ok(plain.includes("↑ 3.0k") && plain.includes("↓ 400"), plain);
    assert.ok(!plain.includes("~"));
  });

  test("idle tokens come from the run ledger, never from session totals", () => {
    // Real ledger: it holds per-Agent-run accounting only, so a session figure has
    // no route into this row. Two turns re-sending history settle at max, not sum.
    const ledger = new AgentRunLedger(() => 9000);
    ledger.startRun(0);
    ledger.recordTurn(tel({ inputTokens: 40000, outputTokens: 5000 }));
    ledger.recordTurn(tel({ inputTokens: 46000, outputTokens: 3000 }));
    ledger.settleRun(null, 1_000_000);
    const h = harness({ ledger });
    renderOnce(h);
    const plain = stripAnsi(h.merged.topTokensText!);
    assert.ok(plain.includes("↑ 46k") && plain.includes("↓ 8.0k"), plain);
    assert.ok(!plain.includes("~"));
  });

  test("before the session's first run the usage row does not exist", () => {
    const h = harness({ ledger: new AgentRunLedger() });
    renderOnce(h);
    assert.equal(h.merged.topTokensText, "");
    // Carried finding from #62: an empty tokens field must not leave a row alive,
    // so the two other fields (and therefore the whole row) are pinned too — and
    // then rendered through the real prepend/status-slot path.
    assert.equal(h.merged.topRightText, "");
    assert.equal(h.merged.topStallText, "");
    const lines = renderThroughEditor(h.merged);
    assert.equal(rowsPrependedAboveEditor({}), 0, "no row was prepended above the frame");
    assert.match(stripAnsi(lines[0] ?? ""), /^╭─/, "the frame is the first row");
    assert.ok(
      !lines.some((line) => /Ready|Working/.test(stripAnsi(line))),
      "an empty slot claims nothing, not even Ready",
    );
  });

  test("running tokens use the incremental display (~ estimated)", () => {
    const h = harness({
      isRunning: true,
      incDisplay: tel({ inputTokens: 111, outputTokens: 222, estimated: true }),
    });
    renderOnce(h);
    const plain = stripAnsi(h.merged.topTokensText!);
    assert.ok(plain.includes("↑~111") || plain.includes("↑ ~"), plain);
  });
});

describe("LiveBorder.render — session run time field", () => {
  test("toggle on → styled duration text reaches the editor chrome", () => {
    const h = harness({ runTime: { totalMs: 8000, running: false } });
    renderOnce(h);
    assert.equal(h.merged.topRunTimeText, "8s");
  });

  test("toggle off → field cleared entirely (no stale value, no dangling pipe upstream)", () => {
    const h = harness({
      runTime: { totalMs: 8000, running: false },
      config: (c) => void (c.sessionRunTime = false),
    });
    renderOnce(h);
    assert.equal(h.merged.topRunTimeText, "");
  });

  test("independent of the context bar: renders with footerSegments.context off", () => {
    const h = harness({
      runTime: { totalMs: 303_000, running: false },
      config: (c) => void (c.footerSegments.context = false),
    });
    renderOnce(h);
    assert.equal(h.merged.topContextText, "");
    assert.equal(h.merged.topRunTimeText, "5m 3s");
  });

  test("no accumulator dep → field stays empty (wiring bug, not a zero)", () => {
    const h = harness();
    delete (h.deps as { getSessionRunTime?: () => unknown }).getSessionRunTime;
    renderOnce(h);
    assert.equal(h.merged.topRunTimeText, "");
  });

  test("live run: the snapshot already folds in the elapsed run (dep contract)", () => {
    const h = harness({ runTime: { totalMs: 9_121_000, running: true } });
    renderOnce(h);
    assert.equal(h.merged.topRunTimeText, "2h 32m 1s");
  });
});
