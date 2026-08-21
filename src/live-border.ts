/**
 * LiveBorder — deep module owning all live chrome (top · context · bottom) behind one seam.
 *
 * Previously src/index.ts scattered refreshTopBorder / refreshLiveTelemetry / refreshContextBar
 * plus startLiveTick/stopLiveTick/liveTickTimer/REFRESH_MS across 8 pi.on handlers with no
 * locality. Adding one border segment touched 6 call sites. Fan-out 8×3 — shallow.
 *
 * Depth: small interface (render / startTick / stopTick) hides coalesced border composition
 * (run-activity + telemetry + context usage) and timer ownership. Callers learn one shape.
 * Impl hides resolveGlyphs, formatContextBar, formatRunActivityTopRight, formatTurnTelemetry,
 * getUsageTotals. One coalesced render per tick/event — not per-delta.
 */

import {
  createChromeSnapshot,
  formatTopContextFromSnapshot,
} from "./chrome-state.js";
import { resolveGlyphs, resolveIconMode } from "./icons.js";
import { formatRunActivityTopRight } from "./run-activity.js";
import type { RunActivityTracker } from "./run-activity.js";
import { formatTelemetryTokens, formatTurnTelemetry } from "./telemetry.js";
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
}

export class LiveBorder {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: LiveBorderDeps) {}

  /** Coalesced render: top (run-activity) + bottom (telemetry) + context bar → editor. */
  render(): void {
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
          this.refreshTopBorder();
          this.refreshLiveTelemetry();
          this.refreshContextBar();
        } else {
          this.refreshContextBar();
        }
      } catch {
        // ignore — best-effort border refresh
      }
    }, REFRESH_MS);
    // don't block process exit
    // SAFETY: pi TUI seam - timer unref is optional NodeJS API
    const t = this.timer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }

  stopTick(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isTicking(): boolean {
    return this.timer !== null;
  }

  // ——— internal: three islands now hidden behind one seam ———

  private refreshTopBorder(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    if (!editor || !ctx) return;
    try {
      // SAFETY: theme is live pi TUI theme read at render time
      const theme = (
        ctx.ui as unknown as { theme: { fg(s: string, t: string): string } }
      ).theme; // SAFETY: pi seam
      const snap = this.deps.runActivityTracker.getSnapshot();
      const text = formatRunActivityTopRight(snap, theme as never);
      editor.setTopRightText(text);
    } catch {
      // ignore
    }
  }

  private refreshLiveTelemetry(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    const cfg = this.deps.getConfig();
    if (!editor) return;
    if (!cfg.telemetry.enabled) {
      try {
        editor.setTelemetryText("");
        editor.setBottomLeftText("");
      } catch {
        // ignore
      }
      return;
    }
    try {
      // SAFETY: peekLive ?? getLastTelemetry preserves cost after toggle (AGENTS.md gotcha)
      const live =
        this.deps.telemetryTracker.peekLive() ??
        this.deps.telemetryTracker.getLastTelemetry();
      if (!live) return;
      // SAFETY: pi TUI seam read-only - theme from extension context
      const theme = (ctx as unknown as { ui?: { theme?: unknown } })?.ui?.theme;
      const glyphs = resolveGlyphs(cfg.icons.mode);
      const right = formatTurnTelemetry(
        live,
        theme as never,
        cfg.telemetry,
        glyphs as never,
      );
      if (live.totalMs > 0) {
        editor.setTelemetryText(right);
        editor.setBottomLeftText("");
      }
    } catch {
      // ignore
    }
  }

  private refreshContextBar(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    const cfg = this.deps.getConfig();
    if (!editor || !ctx) return;
    try {
      // Deepened via ChromeState: snapshot owns contextUsage + totals derivation behind one seam.
      // Two adapters (footer + border) now share the same snapshot — proves the seam.
      // SAFETY: pi seam - snapshot derivation from extension context
      const snapshot = createChromeSnapshot(
        ctx as unknown as Parameters<typeof createChromeSnapshot>[0],
        undefined,
      );
      // SAFETY: pi seam - theme from extension context
      const theme = (ctx as unknown as { ui: { theme: unknown } }).ui
        .theme as unknown as never;
      const glyphs = resolveGlyphs(cfg.icons.mode);
      const isAscii = resolveIconMode(cfg.icons.mode) === "ascii";
      let contextText = "";
      if (
        cfg.footerSegments.context &&
        snapshot.contextUsage &&
        snapshot.contextUsage.contextWindow
      ) {
        contextText = formatTopContextFromSnapshot(
          snapshot,
          theme as never,
          glyphs,
          isAscii,
          (cfg as unknown as { contextIconBar?: boolean }).contextIconBar ??
            false,
        );
      }
      // Tokens line above model info — separate from context bar (moved per user request)
      let tokensText = "";
      if (cfg.telemetry.enabled && cfg.telemetry.tokens) {
        // SAFETY: pi TUI seam - telemetry tokens for top tokens line
        const live =
          this.deps.telemetryTracker.peekLive() ??
          this.deps.telemetryTracker.getLastTelemetry();
        if (live) {
          tokensText = formatTelemetryTokens(
            live,
            theme as never,
            cfg.telemetry,
            glyphs as never,
          );
        } else {
          // default at start time
          // SAFETY: dummy telemetry default tokens at start (↑0·↓0)
          const dummy = {
            inputTokens: 0,
            outputTokens: 0,
          } as unknown as TurnTelemetry;
          tokensText = formatTelemetryTokens(
            dummy,
            theme as never,
            cfg.telemetry,
            glyphs as never,
          );
        }
      }
      editor.setTopContextText(contextText);
      editor.setTopTokensText(tokensText);
    } catch {
      // ignore
    }
  }
}
