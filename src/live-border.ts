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
    );
    // C3: one patch across the whole pass → one setChrome → one requestRender per refresh.
    // Each island keeps its own try/catch, so a failing island still leaves the others'
    // computed fields in the patch, exactly as the old per-island setChrome calls did.
    const patch: Partial<EditorChromeSnapshot> = {};
    this.applyTopBorder(patch, style);
    this.applyTelemetry(patch, style);
    this.applyContext(patch, style, snapshot);
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

  private applyTopBorder(patch: Partial<EditorChromeSnapshot>, style: ChromeStyle): void {
    const cfg = this.deps.getConfig();
    try {
      const snap = this.deps.runActivityTracker.getSnapshot();
      let text = formatRunActivityTopRight(snap, style.theme);
      // Relocate stall to the right of tool use with pipe separator — agent-run live (option B), not bottom telemetry
      if (cfg.telemetry.enabled && cfg.telemetry.stalls) {
        // Deepened via AgentRunLedger — stall is agent-run live, single source
        const tel =
          this.deps.agentLedger.getLiveTotals(this.deps.telemetryTracker.peekLive()) ??
          this.deps.telemetryTracker.getLastTelemetry();
        if (tel && tel.stallMs > 0) {
          const stallText = style.theme.fg(
            "warning",
            `${style.glyphs.stall}${tel.stallCount}×${formatTurnDuration(tel.stallMs).trim()}`,
          );
          if (text) {
            const pipe = style.theme.fg("dim", " | ");
            text = `${text}${pipe}${stallText}`;
          } else {
            text = stallText;
          }
        }
      }
      patch.topRightText = text;
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
          // Hybrid Q7 b: idle shows authoritative billed total (no ~), live shows synthetic incremental (~)
          const display = this.deps.agentLedger.getIdleAuthoritativeDisplay(
            snapshot.totals,
            contextTokens,
          );
          tokensText = formatTelemetryTokens(display, style.theme, cfg.telemetry, style.glyphs);
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
}
