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
import {
  formatTelemetryTokens,
  formatTurnDuration,
  formatTurnTelemetry,
} from "./telemetry.js";
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
  private lastRenderMs = 0;
  private pendingRender: ReturnType<typeof setTimeout> | null = null;

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

  private refreshTopBorder(): void {
    const editor = this.deps.getEditor();
    const ctx = this.deps.getCtx();
    const cfg = this.deps.getConfig();
    if (!editor || !ctx) return;
    try {
      // SAFETY: theme is live pi TUI theme read at render time — intentional unsafe cast, validated at runtime
      const theme = (
        ctx.ui as unknown as { theme: { fg(s: string, t: string): string } }
      ).theme; // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      const snap = this.deps.runActivityTracker.getSnapshot();
      let text = formatRunActivityTopRight(snap, theme as never);
      // Relocate stall to the right of tool use with pipe separator — agent-run live (option B), not bottom telemetry
      if (cfg.telemetry.enabled && cfg.telemetry.stalls) {
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime — telemetry tracker for stall (agent run, option B)
        const tracker = this.deps.telemetryTracker as unknown as {
          peekAgentLive(): import("./telemetry.js").TurnTelemetry | null;
          getLastTelemetry(): import("./telemetry.js").TurnTelemetry | null;
        };
        const tel = tracker.peekAgentLive() ?? tracker.getLastTelemetry();
        if (tel && tel.stallMs > 0) {
          const glyphs = resolveGlyphs(cfg.icons.mode);
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime — theme fg
          const stallText = (
            theme as unknown as { fg: (s: string, t: string) => string }
          ).fg(
            "warning",
            `${glyphs.stall}${tel.stallCount}×${formatTurnDuration(tel.stallMs).trim()}`,
          );
          if (text) {
            // SAFETY: pi seam — intentional unsafe cast, validated at runtime — theme fg for pipe
            const pipe = (
              theme as unknown as { fg: (s: string, t: string) => string }
            ).fg("dim", " | ");
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
    const ctx = this.deps.getCtx();
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
      // SAFETY: peekLive ?? getLastTelemetry preserves cost after toggle (AGENTS.md gotcha) — intentional unsafe cast, validated at runtime
      const live =
        this.deps.telemetryTracker.peekLive() ??
        this.deps.telemetryTracker.getLastTelemetry();
      if (!live) return;
      // SAFETY: pi seam — intentional unsafe cast, validated at runtime — theme from extension context
      const theme = (ctx as unknown as { ui?: { theme?: unknown } })?.ui?.theme;
      const glyphs = resolveGlyphs(cfg.icons.mode);
      // Stall relocated to top right of tool use with pipe — suppress in bottom telemetry
      const bottomCfg = { ...cfg.telemetry, stalls: false };
      const right = formatTurnTelemetry(
        live,
        theme as never,
        bottomCfg as never,
        glyphs as never,
      );
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
      // Deepened via ChromeState: snapshot owns contextUsage + totals derivation behind one seam.
      // Two adapters (footer + border) now share the same snapshot — proves the seam.
      // SAFETY: pi seam - snapshot derivation from extension context
      const snapshot = createChromeSnapshot(
        ctx as unknown as Parameters<typeof createChromeSnapshot>[0], // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        undefined,
      );
      // SAFETY: pi seam - theme from extension context
      const theme = (ctx as unknown as { ui: { theme: unknown } }).ui // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        .theme as unknown as never; // SAFETY: pi seam — intentional unsafe cast, validated at runtime
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
          // SAFETY: intentional unsafe cast — validated at runtime
          (cfg as unknown as { contextIconBar?: boolean }).contextIconBar ?? // SAFETY: pi seam — intentional unsafe cast, validated at runtime
            false,
        );
      }
      // Tokens line above model info — left aligned, no border; hidden at startup per user request
      let tokensText = "";
      if (cfg.telemetry.enabled && cfg.telemetry.tokens) {
        // Live input/output per agent run (option B) — cumulative across turns in this agent, like live output
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime — telemetry tracker for top tokens line (agent run)
        const tracker = this.deps.telemetryTracker as unknown as {
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          peekAgentLive(): import("./telemetry.js").TurnTelemetry | null;
          getLastTelemetry(): import("./telemetry.js").TurnTelemetry | null;
        };
        const live = tracker.peekAgentLive() ?? tracker.getLastTelemetry();
        if (live) {
          tokensText = formatTelemetryTokens(
            live,
            theme as never,
            cfg.telemetry,
            glyphs as never,
          );
        }
      }
      editor.setTopContextText(contextText);
      editor.setTopTokensText(tokensText);
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }
}
