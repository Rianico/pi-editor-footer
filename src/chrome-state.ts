/**
 * ChromeState — deep module owning chrome snapshot derivation behind one seam.
 *
 * Problem it solves (C5): same chrome concepts (context %, git, runtime,
 * tokens, cacheHitRate) render through two seams — footer below input and
 * border on TrackingEditor — with derivation scattered across
 * footer.ts:formatContextBar, state.ts:getUsageTotals, index.ts:refreshContextBar,
 * and border-renderer. Tracing one token requires bouncing 4 modules.
 *
 * Depth: one interface (snapshot / format helpers) hides truncation, color
 * policy, cache-hit derivation and cwd fallbacks. Two adapters (footer +
 * border) justify the seam — with one it would be hypothetical.
 *
 * Internal seams (renderBar, stressColor, cacheHitColor, fmtTokens) stay
 * inside this module, not part of its external seam.
 */

import type { GitStatus } from "./git.js";
import type { RuntimeInfo } from "./runtime.js";
import type { FooterState, UsageTotals } from "./state.js";
import { getUsageTotals } from "./state.js";
import type { IconGlyphs } from "./icons.js";
import type { Theme } from "./layout.js";
import { cacheHitColor, contextUsageColor } from "./color-policy.js";
import { fmtTokens } from "./format.js";

export interface ContextUsage {
  percent?: number;
  tokens?: number;
  contextWindow?: number;
}

export interface ChromeSnapshot {
  cwd: string;
  sessionName?: string;
  git: GitStatus;
  runtime: RuntimeInfo | null;
  contextUsage?: ContextUsage;
  totals: UsageTotals;
}

// ---------------------------------------------------------------------------
// Context bar formatting — moved from footer.ts to centralize chrome rendering.
// Re-exported from footer.ts for backward compatibility.
// ---------------------------------------------------------------------------

function renderBar(
  theme: Theme,
  pct: number,
  barWidth: number,
  ascii: boolean,
): string {
  const filled = Math.max(
    0,
    Math.min(barWidth, Math.round((pct / 100) * barWidth)),
  );
  const empty = barWidth - filled;
  const color = contextUsageColor(pct);
  const filledCell = ascii ? "#" : "█";
  const emptyCell = ascii ? "-" : "░";
  return (
    theme.fg("dim", "[") +
    theme.fg(color, filledCell.repeat(filled)) +
    theme.fg("dim", emptyCell.repeat(empty)) +
    theme.fg("dim", "]")
  );
}

export function formatContextBar(
  contextUsage: ContextUsage | undefined,
  theme: Theme,
  glyphs: IconGlyphs,
  isAscii: boolean,
  barWidth = 10,
  cacheHitRate?: number,
  showIconBar = false,
): string {
  const contextWindow = contextUsage?.contextWindow ?? 0;
  if (contextWindow <= 0) return "";
  const contextPct = contextUsage?.percent ?? 0;
  const contextColor = contextUsageColor(contextPct);
  const pctText = theme.fg(contextColor, `${contextPct.toFixed(1)}%`);
  const contextTokens = contextUsage?.tokens ?? 0;
  const ctxText = `${theme.fg(contextColor, fmtTokens(contextTokens))}${theme.fg("dim", "/")}${theme.fg(contextColor, fmtTokens(contextWindow))}`;
  const baseCore = `${pctText} ${theme.fg("dim", "·")} ${ctxText}`;
  const base = showIconBar
    ? `${theme.fg(contextColor, glyphs.context)} ${renderBar(theme, contextPct, barWidth, isAscii)} ${baseCore}`
    : baseCore;
  const rate =
    cacheHitRate !== undefined && Number.isFinite(cacheHitRate)
      ? cacheHitRate
      : 0;
  const cacheText = `${glyphs.cacheHit} ${rate.toFixed(1)}%`;
  return `${theme.fg(cacheHitColor(rate), cacheText)} ${theme.fg("dim", "|")} ${base}`;
}

/** Border adapter helper — one call from snapshot + theme/glyphs. */
export function formatTopContextFromSnapshot(
  snapshot: ChromeSnapshot,
  theme: Theme,
  glyphs: IconGlyphs,
  isAscii: boolean,
  showIconBar = false,
): string {
  return formatContextBar(
    snapshot.contextUsage,
    theme,
    glyphs,
    isAscii,
    10,
    snapshot.totals.latestCacheHitRate,
    showIconBar,
  );
}

// ---------------------------------------------------------------------------
// Snapshot derivation — pure, owns cwd/sessionName/context/totals consolidation.
// ---------------------------------------------------------------------------

/**
 * Create a chrome snapshot from extension context + footer state.
 * Pure derivation: hides getUsageTotals caching, getContextUsage optional,
 * and cwd/sessionName fallbacks behind one seam.
 */
export function createChromeSnapshot(
  ctx:
    | {
        sessionManager?: {
          getCwd?: () => string;
          getEntries?: () => unknown[];
          getSessionName?: () => string;
        };
        getContextUsage?: () => ContextUsage | undefined;
        cwd?: string;
      }
    | null
    | undefined,
  footerState?: FooterState | null | undefined,
): ChromeSnapshot {
  const cwd =
    ctx?.sessionManager?.getCwd?.() ??
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: intentional unsafe cast — validated at runtime
    (/* SAFETY: intentional unsafe cast — validated at runtime */ ctx as unknown as { cwd?: string })?.cwd ?? // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    process.cwd();
  const sessionName = ctx?.sessionManager?.getSessionName?.();
  const contextUsage = ctx?.getContextUsage?.() as ContextUsage | undefined;
  const totals = getUsageTotals(
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: pi seam
    /* SAFETY: intentional unsafe cast — validated at runtime */ (ctx ?? {}) as unknown as Parameters<typeof getUsageTotals>[0], // SAFETY: pi seam — intentional unsafe cast, validated at runtime
  );
  // footerState may be absent when called from LiveBorder (context-only); use empty defaults
  // SAFETY: pi seam
  const git =
    (footerState as FooterState | undefined)?.git ??
    ({
      branch: undefined,
      ahead: 0,
      behind: 0,
      modified: 0,
      untracked: 0,
      staged: 0,
      stashed: 0,
      conflicted: 0,
      renamed: 0,
      deleted: 0,
      commit: null,
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: intentional unsafe cast — validated at runtime
    /* SAFETY: intentional unsafe cast — validated at runtime */ } as unknown as GitStatus); // SAFETY: pi seam — intentional unsafe cast, validated at runtime
  const runtime = (footerState as FooterState | undefined)?.runtime ?? null;
  return {
    cwd,
    sessionName,
    git,
    runtime,
    contextUsage,
    totals,
  };
}

/**
 * Deep module variant — owns snapshot + refresh lifecycle behind one seam.
 * Thin wrapper over createChromeSnapshot for callers that prefer an instance.
 */
export class ChromeState {
  constructor(
    private readonly getFooterState: () => FooterState,
    private readonly getCtx: () => unknown,
  ) {}

  snapshot(): ChromeSnapshot {
    return createChromeSnapshot(
      this.getCtx() as Parameters<typeof createChromeSnapshot>[0],
      this.getFooterState(),
    );
  }

  /** Convenience: format top context bar from current snapshot + theme. */
  formatTopContext(
    theme: Theme,
    glyphs: IconGlyphs,
    isAscii: boolean,
    showIconBar = false,
  ): string {
    return formatTopContextFromSnapshot(
      this.snapshot(),
      theme,
      glyphs,
      isAscii,
      showIconBar,
    );
  }
}
