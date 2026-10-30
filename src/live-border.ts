/**
 * LiveBorder — deep module owning all live chrome (top · context · bottom) behind one seam.
 *
 * Previously src/index.ts scattered refreshTopBorder / refreshLiveTelemetry / refreshContextBar
 * plus startLiveTick/stopLiveTick/liveTickTimer/REFRESH_MS across 8 pi.on handlers with no
 * locality. Adding one border segment touched 6 call sites. Fan-out 8×3 — shallow.
 *
 * Depth: small interface (render / startTick / stopTick) hides coalesced border composition
 * (run-activity + telemetry + context usage) and timer ownership. Callers learn one shape.
 * Impl hides getUsageTotals and the AgentRunLedger capping. One coalesced render per
 * tick/event — not per-delta — and, since C3, one setChrome (hence one requestRender) per
 * render pass: the three islands write into a single Partial<ChromeSnapshot> patch.
 *
 * C3 dissolved the ChromeComposition pass-through seam: islands call the real formatting
 * functions (telemetry.ts / run-activity.ts / chrome-state.ts) directly with an adapted
 * theme, and that ChromeThemeLike + glyph derivation is cached — rebuilt only when the live
 * theme identity or icons.mode changes, not on every render.
 */

import {
  createChromeSnapshot,
  formatTopContextFromSnapshot,
  type ChromeSnapshot,
} from "./chrome-state.js";
import { adaptTheme, type ChromeThemeLike } from "./chrome-theme.js";
import type { IconGlyphs, IconMode } from "./icons.js";
import { resolveGlyphs, resolveIconMode } from "./icons.js";
import { formatTurnDuration, formatTelemetryTokens, formatTurnTelemetry } from "./telemetry.js";
import { formatRunActivityTopRight } from "./run-activity.js";
import type { RunActivityTracker } from "./run-activity.js";
import type { AgentRunLedger } from "./agent-run-ledger.js";
import type { TurnTelemetryTracker } from "./telemetry.js";
import type { ThemeConfig } from "./config.js";
import type { SessionRunTimeSnapshot } from "./session-run-time.js";
import { formatDuration } from "./format.js";
import type { ChromeSnapshot as EditorChromeSnapshot, TrackingEditor } from "./tracking-editor.js";
import type { ExtensionContextLike } from "./session-orchestrator.js";

export const REFRESH_MS = 1000;

export interface LiveBorderDeps {
  getEditor: () => TrackingEditor | null;
  getCtx: () => ExtensionContextLike | null;
  getConfig: () => ThemeConfig;
  telemetryTracker: TurnTelemetryTracker;
  runActivityTracker: RunActivityTracker;
  agentLedger: AgentRunLedger;
  /**
   * Session run time read — absent dep renders no field (wiring bug, not a zero).
   * The argument is the `subagentUsage` toggle: false asks for the parent-only figure.
   */
  getSessionRunTime?: (includeSubagent: boolean) => SessionRunTimeSnapshot | null;
}

/** Derived once per (theme identity, icon mode) pair, reused across renders. */
interface ChromeStyle {
  theme: ChromeThemeLike;
  glyphs: IconGlyphs;
  isAscii: boolean;
}

export class LiveBorder {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRenderMs = 0;
  private pendingRender: ReturnType<typeof setTimeout> | null = null;
  private cached: { rawTheme: unknown; iconMode: IconMode; style: ChromeStyle } | null = null;

  constructor(private readonly deps: LiveBorderDeps) {}

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

  startTick(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      try {
        this.render();
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

  private doRender(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    if (!editor || !ctx) return;
    const style = this.chromeStyle();
    if (!style) return;
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    const snapshot = createChromeSnapshot(
      // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      ctx as unknown as Parameters<typeof createChromeSnapshot>[0], // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      undefined,
      { includeSubagentUsage: this.deps.getConfig().subagentUsage },
    );
    // C3: one patch across the whole pass → one setChrome → one requestRender per refresh.
    // Each island keeps its own try/catch, so a failing island still leaves the others'
    // computed fields in the patch, exactly as the old per-island setChrome calls did.
    const patch: Partial<EditorChromeSnapshot> = {};
    this.applyTopBorder(patch, style);
    this.applyTelemetry(patch, style);
    this.applyContext(patch, style, snapshot);
    this.applyRunTime(patch, style);
    if (Object.keys(patch).length > 0) {
      try {
        editor.setChrome(patch);
      } catch {
        // SAFETY: best-effort UI, ignore recoverable error
      }
    }
  }

  // ——— internal: three islands now hidden behind one seam ———

  /**
   * Cached theme-adapter + glyph derivation (C3): rebuilt only when the live theme
   * identity or icons.mode changes — constructing on every render was the waste.
   */
  private chromeStyle(): ChromeStyle | null {
    const ctx = this.deps.getCtx();
    if (!ctx) return null;
    const iconMode = this.deps.getConfig().icons.mode;
    const rawTheme = ctx.ui.theme;
    const cached = this.cached;
    if (cached !== null && cached.rawTheme === rawTheme && cached.iconMode === iconMode) {
      return cached.style;
    }
    const style: ChromeStyle = {
      theme: adaptTheme(rawTheme),
      glyphs: resolveGlyphs(iconMode),
      isAscii: resolveIconMode(iconMode) === "ascii",
    };
    this.cached = { rawTheme, iconMode, style };
    return style;
  }

  /**
   * Run activity is the run field's second half; the stall is a condition, so it
   * is written as its own field and the row composer separates it with `|`
   * (ADR-0004 rev 3). Keeping them apart is what keeps the stall out of the
   * activity's `·` sections.
   *
   * **A stall is reported only while the current run is actually stalled.** It is
   * therefore read from the ledger's live aggregate alone — no `getLastTelemetry()`
   * fallback: that tracker keeps the *previous* run's figures until the next turn
   * starts (it resets on model select, not on `agent_start`), so a fresh, healthy
   * run would inherit the last run's `!2×`, and so would the idle row.
   */
  private applyTopBorder(patch: Partial<EditorChromeSnapshot>, style: ChromeStyle): void {
    const cfg = this.deps.getConfig();
    try {
      const snap = this.deps.runActivityTracker.getSnapshot();
      const text = formatRunActivityTopRight(snap, style.theme);
      let stallText = "";
      if (cfg.telemetry.enabled && cfg.telemetry.stalls) {
        // Live-only: null until this run has a turn or a live turn, null again once
        // it settles. Both are correct — neither is a stall of the current run.
        const tel = this.deps.agentLedger.getLiveTotals(this.deps.telemetryTracker.peekLive());
        if (tel && tel.stallMs > 0) {
          stallText = style.theme.fg(
            "warning",
            `${style.glyphs.stall}${tel.stallCount}×${formatTurnDuration(tel.stallMs).trim()}`,
          );
        }
      }
      patch.topRightText = text;
      patch.topStallText = stallText;
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }

  private applyTelemetry(patch: Partial<EditorChromeSnapshot>, style: ChromeStyle): void {
    const cfg = this.deps.getConfig();
    if (!cfg.telemetry.enabled) {
      patch.telemetryText = "";
      patch.bottomLeftText = "";
      return;
    }
    try {
      // peekLive ?? getLastTelemetry preserves cost after toggle (AGENTS.md gotcha)
      const live =
        this.deps.telemetryTracker.peekLive() ?? this.deps.telemetryTracker.getLastTelemetry();
      if (!live) return;
      // Stall relocated to top right of tool use with pipe — suppress in bottom telemetry
      const bottomCfg = { ...cfg.telemetry, stalls: false };
      const right = formatTurnTelemetry(live, style.theme, bottomCfg, style.glyphs);
      if (live.totalMs > 0) {
        patch.telemetryText = right;
        patch.bottomLeftText = "";
      }
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }

  private applyContext(
    patch: Partial<EditorChromeSnapshot>,
    style: ChromeStyle,
    snapshot: ChromeSnapshot,
  ): void {
    const cfg = this.deps.getConfig();
    try {
      let contextText = "";
      if (
        cfg.footerSegments.context &&
        snapshot.contextUsage &&
        snapshot.contextUsage.contextWindow
      ) {
        contextText = formatTopContextFromSnapshot(
          snapshot,
          style.theme,
          style.glyphs,
          style.isAscii,
          cfg.contextIconBar,
        );
      }
      let tokensText = "";
      if (cfg.telemetry.enabled && cfg.telemetry.tokens) {
        const isRunning = this.deps.runActivityTracker.isRunning();
        const contextTokens = snapshot.contextUsage?.tokens;
        if (!isRunning) {
          // Delta tokens at rest: the last Agent run's own figures, frozen by the ledger
          // at settle (GLOSSARY "Delta tokens"). No session fallback — before the first
          // run of a fresh *or resumed* session the field stays empty, so the row does
          // not exist yet.
          const display = this.deps.agentLedger.getAtRestTotals();
          if (display) {
            tokensText = formatTelemetryTokens(display, style.theme, cfg.telemetry, style.glyphs);
          }
        } else {
          const liveTurn = this.deps.telemetryTracker.peekLive();
          const agentLive =
            this.deps.agentLedger.getLiveTotals(liveTurn) ??
            this.deps.telemetryTracker.getLastTelemetry();
          const display = this.deps.agentLedger.getIncrementalLiveDisplayTotals(
            liveTurn,
            agentLive,
            contextTokens,
          );
          if (display) {
            tokensText = formatTelemetryTokens(display, style.theme, cfg.telemetry, style.glyphs);
          }
        }
      }
      patch.topContextText = contextText;
      patch.topTokensText = tokensText;
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }

  /**
   * Session run time — the left label's rightmost FIELD, gated ONLY by its own
   * toggle (independent of `footerSegments.context`; the border renderer joins
   * present fields with dim pipes, so either side can be absent cleanly).
   * Grows live on the 1 Hz tick while a run is in flight (snapshot folds in the
   * elapsed run), static at the settled accumulation between runs. Delegated work
   * joins that figure only while `subagentUsage` is on.
   */
  private applyRunTime(patch: Partial<EditorChromeSnapshot>, style: ChromeStyle): void {
    const cfg = this.deps.getConfig();
    try {
      let runTimeText = "";
      if (cfg.sessionRunTime) {
        const snap = this.deps.getSessionRunTime?.(cfg.subagentUsage);
        if (snap) {
          // Same token as the telemetry TTFT segment (telemetry.ts formatTurnTelemetry)
          runTimeText = style.theme.fg("text", formatDuration(snap.totalMs));
        }
      }
      patch.topRunTimeText = runTimeText;
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }
}
