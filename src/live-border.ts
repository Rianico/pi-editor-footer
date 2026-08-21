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

import { formatContextBar } from "./chrome-state.js";
import { resolveGlyphs, resolveIconMode } from "./icons.js";
import { getUsageTotals } from "./state.js";
import { formatRunActivityTopRight } from "./run-activity.js";
import type { RunActivityTracker } from "./run-activity.js";
import { formatTurnTelemetry } from "./telemetry.js";
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
    const t = this.timer as unknown as { unref?: () => void }; // SAFETY: pi TUI seam read-only
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
      const theme = (ctx.ui as unknown as { theme: { fg(s: string, t: string): string } }).theme; // SAFETY: pi seam
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
    if (!editor || !cfg.telemetry.enabled) return;
    try {
      // SAFETY: peekLive ?? getLastTelemetry preserves cost after toggle (AGENTS.md gotcha)
      const live =
        this.deps.telemetryTracker.peekLive() ?? this.deps.telemetryTracker.getLastTelemetry();
      if (!live) return;
      const theme = (ctx as unknown as { ui?: { theme?: unknown } })?.ui?.theme; // SAFETY: pi TUI seam read-only
      const text = formatTurnTelemetry(live, theme as never, cfg.telemetry);
      if (live.totalMs > 0) editor.setTelemetryText(text);
    } catch {
      // ignore
    }
  }

  private refreshContextBar(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    const cfg = this.deps.getConfig();
    if (!editor || !ctx) return;
    if (!cfg.footerSegments.context) {
      try {
        editor.setTopContextText("");
      } catch {
        // ignore
      }
      return;
    }
    try {
      // SAFETY: getContextUsage is pi runtime extension — may be absent in tests
      const ctxAny = ctx as unknown as { // SAFETY: pi seam
        getContextUsage?: () => { percent?: number; tokens?: number; contextWindow?: number };
      };
      const usage = ctxAny.getContextUsage?.();
      if (!usage || !usage.contextWindow) {
        editor.setTopContextText("");
        return;
      }
      const theme = (ctx as unknown as { ui: { theme: unknown } }).ui.theme as unknown as never; // SAFETY: pi TUI seam read-only
      const glyphs = resolveGlyphs(cfg.icons.mode);
      const isAscii = resolveIconMode(cfg.icons.mode) === "ascii";
      let cacheHitRate: number | undefined;
      try {
        const totals = getUsageTotals(
          ctx as unknown as Parameters<typeof getUsageTotals>[0], // SAFETY: pi TUI seam read-only
        );
        cacheHitRate = totals.latestCacheHitRate;
      } catch {
        // ignore
      }
      const text = formatContextBar(
        usage,
        theme as never,
        glyphs,
        isAscii,
        10,
        cacheHitRate,
        (cfg as unknown as { contextIconBar?: boolean }).contextIconBar ?? false, // SAFETY: pi TUI seam read-only
      );
      editor.setTopContextText(text);
    } catch {
      // ignore
    }
  }
}