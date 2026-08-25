/**
 * LiveBorder — deep module owning all live chrome (top · context · bottom) behind one seam.
 *
 * Previously src/index.ts scattered refreshTopBorder / refreshLiveTelemetry / refreshContextBar
 * plus startLiveTick/stopLiveTick/liveTickTimer/REFRESH_MS across 8 pi.on handlers with no
 * locality. Adding one border segment touched 6 call sites. Fan-out 8×3 — shallow.
 *
 * Depth: small interface (render / startTick / stopTick) hides coalesced border composition
 * (run-activity + telemetry + context usage) and timer ownership. Callers learn one shape.
 * Impl hides ChromeComposition (glyphs + theme + chrome format), getUsageTotals, and the
 * AgentRunLedger capping. One coalesced render per tick/event — not per-delta.
 *
 * Glyph/theme derivation (C3) lives in ChromeComposition — LiveBorder no longer calls
 * resolveGlyphs/resolveIconMode or casts the live theme; it queries composition once.
 */

import { createChromeSnapshot } from "./chrome-state.js";
import { ChromeComposition } from "./chrome-composition.js";
import type { RunActivityTracker } from "./run-activity.js";
import type { UsageTotals } from "./state.js";
import type { AgentRunLedger } from "./agent-run-ledger.js";
import type { TurnTelemetry } from "./telemetry.js";
import type { TurnTelemetryTracker } from "./telemetry.js";
import type { ThemeConfig } from "./config.js";
import type { TrackingEditor } from "./tracking-editor.js";
import type { ExtensionContextLike } from "./index.js";

export const REFRESH_MS = 1000;

export interface LiveBorderDeps {
  getEditor: () => TrackingEditor | null;
  getCtx: () => ExtensionContextLike | null;
  getConfig: () => ThemeConfig;
  telemetryTracker: TurnTelemetryTracker;
  runActivityTracker: RunActivityTracker;
  agentLedger?: AgentRunLedger;
}

export class LiveBorder {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRenderMs = 0;
  private pendingRender: ReturnType<typeof setTimeout> | null = null;
  private agentBaseline: UsageTotals | null = null;
  private get agentLedger(): AgentRunLedger | undefined {
    return this.deps.agentLedger;
  }

  constructor(private readonly deps: LiveBorderDeps) {}

  /** Set baseline totals at agent_start for per-agent delta (input/output/cost). */
  setAgentBaseline(baseline: UsageTotals | null): void {
    this.agentBaseline = baseline ? { ...baseline } : null;
  }

  /** Coalesced render: top (run-activity) + bottom (telemetry) + context bar → editor. */
  render(): void {
    const now = Date.now();
    if (now - this.lastRenderMs < REFRESH_MS) {
      if (this.pendingRender === null) {
        const delay = REFRESH_MS - (now - this.lastRenderMs);
        this.pendingRender = setTimeout(() => {
          this.pendingRender = null;
          this.lastRenderMs = Date.now();
          this.doRender();
        }, delay);
        // SAFETY: pi TUI seam - timer unref is optional NodeJS API
        const t = this.pendingRender as unknown as { unref?: () => void }; // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        if (typeof t.unref === "function") t.unref();
      }
      return;
    }
    this.lastRenderMs = now;
    this.doRender();
  }

  private doRender(): void {
    this.refreshTopBorder();
    this.refreshLiveTelemetry();
    this.refreshContextBar();
  }

  /** Alias for render — kept for call-site readability (refreshAllLive migration). */
  refreshAll(): void {
    this.render();
  }

  startTick(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      try {
        if (this.deps.runActivityTracker.isRunning()) {
          this.render();
        } else {
          this.refreshContextBar();
        }
      } catch {
        // SAFETY: best-effort, ignore recoverable error
      }
    }, REFRESH_MS);
    // don't block process exit
    // SAFETY: pi TUI seam - timer unref is optional NodeJS API
    const t = this.timer as unknown as { unref?: () => void }; // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    if (typeof t.unref === "function") t.unref();
  }

  stopTick(): void {
    if (this.pendingRender !== null) {
      clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isTicking(): boolean {
    return this.timer !== null;
  }

  // ——— internal: three islands now hidden behind one seam ———

  /** Build one ChromeComposition from the live config + theme (per-render, theme is live). */
  private composition(): ChromeComposition | null {
    const ctx = this.deps.getCtx();
    const cfg = this.deps.getConfig();
    if (!ctx) return null;
    // SAFETY: pi context seam — ctx.ui.theme is the live TUI theme (ThemeLike shape)
    return new ChromeComposition(cfg.icons.mode, ctx.ui.theme);
  }

  private refreshTopBorder(): void {
    const editor = this.deps.getEditor();
    const cfg = this.deps.getConfig();
    if (!editor) return;
    try {
      const comp = this.composition();
      if (!comp) return;
      const snap = this.deps.runActivityTracker.getSnapshot();
      let text = comp.formatRunActivityTopRight(snap);
      // Relocate stall to the right of tool use with pipe separator — agent-run live (option B), not bottom telemetry
      if (cfg.telemetry.enabled && cfg.telemetry.stalls) {
        // Deepened via AgentRunLedger — stall is agent-run live, single source
        const tel =
          this.agentLedger?.getLiveTotals(
            this.deps.telemetryTracker.peekLive(),
          ) ?? this.deps.telemetryTracker.getLastTelemetry();
        if (tel && tel.stallMs > 0) {
          const stallText = comp.formatStall(tel);
          if (text) {
            const pipe = comp.dim(" | ");
            text = `${text}${pipe}${stallText}`;
          } else {
            text = stallText;
          }
        }
      }
      editor.setTopRightText(text);
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }

  private refreshLiveTelemetry(): void {
    const editor = this.deps.getEditor();
    const cfg = this.deps.getConfig();
    if (!editor) return;
    if (!cfg.telemetry.enabled) {
      try {
        editor.setTelemetryText("");
        editor.setBottomLeftText("");
      } catch {
        // SAFETY: best-effort UI, ignore recoverable error
      }
      return;
    }
    try {
      // peekLive ?? getLastTelemetry preserves cost after toggle (AGENTS.md gotcha)
      const live =
        this.deps.telemetryTracker.peekLive() ??
        this.deps.telemetryTracker.getLastTelemetry();
      if (!live) return;
      const comp = this.composition();
      if (!comp) return;
      // Stall relocated to top right of tool use with pipe — suppress in bottom telemetry
      const bottomCfg = { ...cfg.telemetry, stalls: false };
      const right = comp.formatTurnTelemetry(live, bottomCfg);
      if (live.totalMs > 0) {
        editor.setTelemetryText(right);
        editor.setBottomLeftText("");
      }
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }

  private refreshContextBar(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    const cfg = this.deps.getConfig();
    if (!editor || !ctx) return;
    try {
      const comp = this.composition();
      if (!comp) return;
      const snapshot = createChromeSnapshot(
        ctx as unknown as Parameters<typeof createChromeSnapshot>[0], // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        undefined,
      );
      let contextText = "";
      if (
        cfg.footerSegments.context &&
        snapshot.contextUsage &&
        snapshot.contextUsage.contextWindow
      ) {
        contextText = comp.formatTopContext(
          snapshot,
          // SAFETY: intentional unsafe cast — validated at runtime
          (cfg as unknown as { contextIconBar?: boolean }).contextIconBar ?? // SAFETY: pi seam — intentional unsafe cast, validated at runtime
            false,
        );
      }
      let tokensText = "";
      if (cfg.telemetry.enabled && cfg.telemetry.tokens) {
        const isRunning = this.deps.runActivityTracker.isRunning();
        const contextTokens = snapshot.contextUsage?.tokens;
        // Deepened via AgentRunLedger — single source for capped per-agent display.
        if (this.agentLedger) {
          if (!isRunning) {
            const telIdle =
              this.agentLedger?.getLiveTotals(
                this.deps.telemetryTracker.peekLive(),
              ) ?? this.deps.telemetryTracker.getLastTelemetry();
            const display = this.agentLedger.getIdleDisplayTotals(
              snapshot.totals,
              contextTokens,
              telIdle,
            );
            tokensText = comp.formatTelemetryTokens(display, cfg.telemetry);
          } else {
            const liveTurn = this.deps.telemetryTracker.peekLive();
            const agentLive =
              this.agentLedger?.getLiveTotals(liveTurn) ??
              this.deps.telemetryTracker.getLastTelemetry();
            const display = this.agentLedger.getLiveDisplayTotals(
              liveTurn,
              agentLive,
              contextTokens,
            );
            if (display) {
              tokensText = comp.formatTelemetryTokens(display, cfg.telemetry);
            }
          }
        } else if (!isRunning && this.agentBaseline) {
          // Fallback when ledger not wired (backward compat)
          const cur = snapshot.totals;
          const base = this.agentBaseline;
          const telIdle = this.deps.telemetryTracker.getLastTelemetry();
          let displayInput: number;
          let displayOutput: number;
          let displayCost: number;
          if (telIdle) {
            displayInput = telIdle.inputTokens;
            displayOutput = telIdle.outputTokens;
            displayCost = telIdle.costUsd;
          } else {
            displayInput = Math.max(0, cur.input - base.input);
            displayOutput = Math.max(0, cur.output - base.output);
            displayCost = Math.max(0, cur.cost - base.cost);
          }
          if (snapshot.contextUsage?.tokens)
            displayInput = Math.min(displayInput, snapshot.contextUsage.tokens);
          if (cur.input > 0) displayInput = Math.min(displayInput, cur.input);
          const deltaTel: TurnTelemetry = {
            tps: null,
            ttftMs: 0,
            totalMs: 0,
            inputTokens: displayInput,
            outputTokens: displayOutput,
            stallMs: 0,
            stallCount: 0,
            rateUsdPerMTokens: null,
            generationMs: 0,
            totalTokens: displayInput + displayOutput,
            costUsd: displayCost,
            measurementMs: null,
          };
          tokensText = comp.formatTelemetryTokens(deltaTel, cfg.telemetry);
        } else if (isRunning) {
          const liveTurn = this.deps.telemetryTracker.peekLive();
          const agentLive = this.deps.telemetryTracker.getLastTelemetry();
          let displayLive = agentLive;
          if (
            agentLive &&
            liveTurn &&
            this.deps.runActivityTracker.isRunning()
          ) {
            displayLive = {
              ...agentLive,
              inputTokens: liveTurn.inputTokens,
              totalTokens: liveTurn.inputTokens + agentLive.outputTokens,
            };
          }
          if (displayLive) {
            let cappedInput = displayLive.inputTokens;
            if (snapshot.contextUsage?.tokens)
              cappedInput = Math.min(cappedInput, snapshot.contextUsage.tokens);
            displayLive = {
              ...displayLive,
              inputTokens: cappedInput,
              totalTokens: cappedInput + displayLive.outputTokens,
            };
            tokensText = comp.formatTelemetryTokens(displayLive, cfg.telemetry);
          }
        }
      }
      editor.setTopContextText(contextText);
      editor.setTopTokensText(tokensText);
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }
}
