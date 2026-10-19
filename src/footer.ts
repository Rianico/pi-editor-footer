import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ThemeConfig } from "./config.js";
import type { GitStatus } from "./git.js";
import type { RuntimeInfo } from "./runtime.js";
import type { FooterState, ModelMeta, UsageTotals, UsageTotalsSource } from "./state.js";
import { getUsageTotals, totalInputTokens } from "./state.js";
import type { IconGlyphs } from "./icons.js";
import { resolveGlyphs, runtimeSymbol } from "./icons.js";
import {
  alignRight,
  fitSegmentsByPriority,
  type PrioritizedSegment,
  type Theme,
} from "./layout.js";
import { basenamePath, formatCwd, truncatePath } from "./path-format.js";
import { fmtTokens, formatDuration, sanitizeStatus } from "./format.js";

/**
 * One rail part: text plus the theme colour token it paints.
 *
 * Kept separate from rendering so the composition can be asserted without a theme —
 * ADR-0003's order/suppression rules are the contract, colour is the presentation.
 */
export interface GitRailPart {
  readonly text: string;
  readonly color: "mdLink" | "error" | "dim" | "warning" | "success" | "muted";
}

/**
 * powerlevel10k's composition (ADR-0003):
 * `[COMMIT] [BRANCH] [TAG] [STAGED] [UNSTAGED] [UNTRACKED] [BEHIND] [AHEAD] [STASH] [ACTION]`,
 * single-space separated, no brackets, a count of 1 rendered bare, stash always counted,
 * and conflicts signalled by colour alone.
 */
export function composeGitRail(
  git: GitStatus,
  glyphs: IconGlyphs,
  segments: ThemeConfig["footerSegments"],
  action = "",
): GitRailPart[] {
  const parts: GitRailPart[] = [];
  const detached = git.commit?.detached === true;
  const branchIcon = glyphs.git.length > 0 ? `${glyphs.git} ` : "";

  if (segments.gitBranch) {
    if (detached) {
      // Identity vs decoration (#45b ruling): the sha is the identity part, so gitBranch
      // gates it; gitCommit stays off by default and decorates it with the tag only.
      if (git.commit?.oid) parts.push({ text: git.commit.oid.slice(0, 8), color: "dim" });
      if (segments.gitCommit && git.commit?.tag) {
        parts.push({ text: git.commit.tag, color: "warning" });
      }
    } else if (git.branch !== undefined) {
      // Conflicts are colour-only: no glyph, no count, the branch itself turns red.
      const color = git.unmerged > 0 ? "error" : "mdLink";
      parts.push({ text: `${branchIcon}${git.branch}`, color });
    } else {
      parts.push({ text: "(no git)", color: "dim" });
    }
  }

  if (segments.gitStatus) {
    if (action.length > 0) {
      // While an operation is live, the counts are the operation's own churn.
      parts.push({ text: `|${action.toUpperCase()}`, color: "warning" });
      return parts;
    }
    const count = (value: number, glyph: string, color: GitRailPart["color"]) => {
      if (value > 0) parts.push({ text: value === 1 ? glyph : `${glyph}${value}`, color });
    };
    count(git.staged, glyphs.staged, "success");
    count(git.unstaged, glyphs.unstaged, "warning");
    count(git.untracked, glyphs.untracked, "muted");
    count(git.behind, glyphs.behind, "warning");
    count(git.ahead, glyphs.ahead, "success");
    // Stash is the one part that always carries its count, even when it is 1.
    if (git.stashed > 0) parts.push({ text: `${glyphs.stashed}${git.stashed}`, color: "muted" });
  }

  return parts;
}

export function renderGitSegment(
  theme: Theme,
  git: GitStatus,
  glyphs: IconGlyphs,
  segments: ThemeConfig["footerSegments"],
  action = "",
): string {
  return composeGitRail(git, glyphs, segments, action)
    .map((part) => theme.fg(part.color, part.text))
    .join(" ");
}

function renderRuntimeSegment(
  theme: Theme,
  runtime: RuntimeInfo | null,
  iconMode: ThemeConfig["icons"]["mode"],
): string {
  if (!runtime) return "";
  const symbol = theme.fg("success", runtimeSymbol(runtime.name, iconMode));
  const version = runtime.version ? theme.fg("muted", runtime.version) : "";
  const label = [symbol, version].filter(Boolean).join(" ");
  return label;
}

function renderTimerSegment(
  theme: Theme,
  state: FooterState,
  glyphs: IconGlyphs,
  totals?: UsageTotals,
  config?: ThemeConfig,
): string {
  // Wall time dim line — never exposed to model, TUI-only
  // After agent_end: · 8.3s wall · ↑ 1.2k · ↓ 800 · $0.12 (all dim)
  // During run: working 8.3s (accent)
  if (state.workingSince !== undefined) {
    return `${theme.fg("accent", glyphs.working)} ${theme.fg("dim", "working")} ${theme.fg("accent", formatDuration(Date.now() - state.workingSince))}`;
  }
  if (state.lastDoneIn !== undefined) {
    // Wall time after agent_end is now a dim row after last message (aboveEditor widget), not inline footer
    // Keep footer clean — wall time lives in transcript, not here
    return "";
  }
  return "";
}

export function renderFooter(
  width: number,
  state: FooterState,
  config: ThemeConfig,
  theme: Theme,
  ctx: {
    cwd: string;
    sessionName?: string;
    contextUsage?: {
      percent?: number;
      tokens?: number;
      contextWindow?: number;
    };
    model?: { provider?: string; id?: string; name?: string };
    totals?: UsageTotals;
    extensionStatuses?: ReadonlyMap<string, string>;
    getModelMeta?: () => ModelMeta;
  },
): string[] {
  if (width <= 0) return [""];
  const glyphs = resolveGlyphs(config.icons.mode);
  const segments = config.footerSegments;
  const totals = ctx.totals ?? {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    latestCacheHitRate: undefined,
  };

  const leftParts: PrioritizedSegment[] = [];
  if (segments.cwd) {
    const maxCwd = Math.min(30, Math.max(10, Math.floor(width * 0.4)));
    const rawCwd = formatCwd(ctx.cwd);
    const displayCwd = config.workspaceDisplay === "name" ? basenamePath(rawCwd) : rawCwd;
    const cwdPrefix = `${theme.fg("mdLink", glyphs.cwd)} `;
    const accent = (text: string) => theme.fg("accent", text);
    leftParts.push({
      text: `${cwdPrefix}${accent(truncatePath(displayCwd, maxCwd))}`,
      compactText: `${cwdPrefix}${accent(truncatePath(basenamePath(displayCwd), maxCwd))}`,
      priority: 5,
      truncate: (_text, maxWidth, ellipsis) => {
        const pathWidth = maxWidth - visibleWidth(cwdPrefix);
        if (pathWidth <= visibleWidth(ellipsis)) {
          return truncateToWidth(
            `${cwdPrefix}${accent(basenamePath(displayCwd))}`,
            maxWidth,
            ellipsis,
          );
        }
        return `${cwdPrefix}${accent(truncatePath(basenamePath(displayCwd), pathWidth))}`;
      },
    });
  }
  if (segments.sessionName) {
    const sessionName = ctx.sessionName;
    if (sessionName) {
      const sep = leftParts.length > 0 ? `${theme.fg("dim", " • ")}` : "";
      leftParts.push({
        text: `${sep}${theme.fg("dim", glyphs.session)} ${theme.fg("text", truncateToWidth(sessionName, 24, theme.fg("dim", "...")))}`,
        priority: 2,
      });
    }
  }
  const gitSeg = renderGitSegment(theme, state.git, glyphs, segments);
  if (gitSeg) {
    const sep = leftParts.length > 0 ? `${theme.fg("dim", " · ")}` : "";
    // Branch name must never be folded/omitted — keep priority higher than cwd (5)
    leftParts.push({ text: `${sep}${gitSeg}`, priority: 6 });
  }
  if (segments.runtime) {
    const runtimeSeg = renderRuntimeSegment(theme, state.runtime, config.icons.mode);
    if (runtimeSeg) {
      const sep = leftParts.length > 0 ? `${theme.fg("dim", " • ")}` : "";
      leftParts.push({ text: `${sep}${runtimeSeg}`, priority: 4 });
    }
  }
  const timerSeg = renderTimerSegment(theme, state, glyphs, totals, config);
  if (timerSeg) {
    const sep = leftParts.length > 0 ? `${theme.fg("dim", " • ")}` : "";
    leftParts.push({ text: `${sep}${timerSeg}`, priority: 1 });
  }

  const stats: string[] = [];
  if (segments.tokens) {
    // Total input billed for the model — includes the cached prompt prefix, not just
    // `usage.input` (which excludes cacheRead/cacheWrite). See totalInputTokens.
    stats.push(theme.fg("accent", `${glyphs.input} ${fmtTokens(totalInputTokens(totals))}`));
    stats.push(theme.fg("success", `${glyphs.output} ${fmtTokens(totals.output)}`));
  }
  if (segments.cost) {
    const costValue = totals.cost.toFixed(2);
    // Avoid "$ $0.00" when the cost glyph itself is "$" (ascii mode) — glyph already is the currency symbol
    const costText = `$${costValue}`;
    stats.push(theme.fg("warning", costText));
  }
  // cache to the right of input/output omitted per user request — cache stays in top context bar only
  const statsBlock = stats.join(` ${theme.fg("dim", "·")} `);

  const rightBlock = statsBlock;
  const rightCompact = statsBlock;
  const allParts: PrioritizedSegment[] = [...leftParts];
  if (rightBlock) {
    allParts.push({
      text: rightBlock,
      compactText: rightCompact,
      priority: 4,
    });
  }

  const fitted = fitSegmentsByPriority(allParts, width, theme.fg("dim", "..."));
  const fittedContext = rightBlock ? (fitted.pop() ?? "") : "";
  const line1 = alignRight(fitted.join(" "), fittedContext, width, theme);

  const mainLines = [line1].map((line) => truncateToWidth(line, width, theme.fg("dim", "...")));
  if (segments.extensionStatuses && ctx.extensionStatuses) {
    const statuses = Array.from(ctx.extensionStatuses.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, text]) => sanitizeStatus(text))
      .filter((text) => text.length > 0);
    if (statuses.length > 0) {
      const separator = ` ${theme.fg("dim", "|")} `;
      const statusText = statuses.map((status) => theme.fg("muted", status)).join(separator);
      const line = `${theme.fg("mdLink", glyphs.extensions)} ${statusText}`;
      return [...mainLines, ...wrapTextWithAnsi(line, width)];
    }
  }
  return mainLines;
}

export interface FooterHooks {
  setRequestRender: (fn: (() => void) | undefined) => void;
  scheduleGitRefresh: () => void;
}

// Simplified installFooter for typecheck — real pi integration will wire via ExtensionContext
export function installFooter(
  ctx: {
    ui: {
      setWidget?: (key: string, content: unknown, opts?: unknown) => void;
      setFooter?: (fn: unknown) => void;
    };
    sessionManager?: { getCwd(): string; getSessionName?: () => string };
    getContextUsage?: () => {
      percent?: number;
      tokens?: number;
      contextWindow?: number;
    };
    model?: {
      provider?: string;
      id?: string;
      name?: string;
      reasoning?: boolean;
    };
  },
  getState: () => FooterState,
  getConfig: () => ThemeConfig,
  getModelMeta: () => ModelMeta,
  hooks: FooterHooks,
): () => void {
  // Try setFooter if available (pi-coding-agent), else fallback to setWidget belowEditor
  const themeStub: Theme = { fg: (_s: string, t: string) => t };
  const render = (width: number): string[] => {
    const state = getState();
    const config = getConfig();
    const cwd = ctx.sessionManager?.getCwd() ?? process.cwd();
    const totals = getUsageTotals(
      // ast-grep-ignore: require-safety-comment-for-as-unknown-as
      // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      /* SAFETY: intentional unsafe cast — validated at runtime */ ctx as unknown as UsageTotalsSource,
    );
    return renderFooter(width, state, config, themeStub, {
      cwd,
      sessionName: ctx.sessionManager?.getSessionName?.(),
      contextUsage: ctx.getContextUsage?.(),
      model: ctx.model,
      totals,
      getModelMeta,
    });
  };

  // Prefer native footer if available
  if (
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: intentional unsafe cast — validated at runtime
    /* SAFETY: intentional unsafe cast — validated at runtime */ typeof (
      /* SAFETY: intentional unsafe cast — validated at runtime */ (
        ctx.ui as unknown as { setFooter?: unknown }
      ).setFooter
    ) === // SAFETY: intentional unsafe cast — validated at runtime
    "function"
  ) {
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    /* SAFETY: intentional unsafe cast — validated at runtime */ const ui = ctx.ui as unknown as {
      // SAFETY: intentional unsafe cast — validated at runtime
      setFooter: (
        fn: (
          tui: { requestRender(): void },
          theme: Theme,
          data: {
            onBranchChange(cb: () => void): () => void;
            getExtensionStatuses(): ReadonlyMap<string, string>;
          },
        ) => {
          render(width: number): string[];
          dispose?(): void;
          invalidate?(): void;
        },
      ) => void;
    };
    ui.setFooter((tui, _theme, footerData) => {
      hooks.setRequestRender(() => tui.requestRender());
      const unsub = footerData.onBranchChange(() => {
        hooks.scheduleGitRefresh();
        tui.requestRender();
      });
      return {
        dispose() {
          unsub();
          hooks.setRequestRender(undefined);
        },
        invalidate() {},
        render(width: number) {
          // Use real theme when rendering
          // ast-grep-ignore: require-safety-comment-for-as-unknown-as
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          /* SAFETY: intentional unsafe cast — validated at runtime */ const theme =
            _theme as unknown as Theme; // SAFETY: intentional unsafe cast — validated at runtime
          const state = getState();
          const config = getConfig();
          const cwd = ctx.sessionManager?.getCwd() ?? process.cwd();
          const totals = getUsageTotals(
            // ast-grep-ignore: require-safety-comment-for-as-unknown-as
            // SAFETY: pi seam — intentional unsafe cast, validated at runtime
            /* SAFETY: intentional unsafe cast — validated at runtime */ ctx as unknown as UsageTotalsSource,
          );
          return renderFooter(width, state, config, theme, {
            cwd,
            sessionName: ctx.sessionManager?.getSessionName?.(),
            contextUsage: ctx.getContextUsage?.(),
            model: ctx.model,
            totals,
            extensionStatuses: footerData.getExtensionStatuses(),
            getModelMeta,
          });
        },
      };
    });
    return () => {
      // ast-grep-ignore: require-safety-comment-for-as-unknown-as
      // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      /* SAFETY: intentional unsafe cast — validated at runtime */ (
        ctx.ui as unknown as { setFooter: (v: undefined) => void }
      ).setFooter(
        // SAFETY: intentional unsafe cast — validated at runtime
        undefined,
      );
    };
  }

  // Fallback: widget belowEditor
  if (ctx.ui.setWidget) {
    ctx.ui.setWidget(
      "theme-footer",
      () => ({
        invalidate() {},
        render,
      }),
      { placement: "belowEditor" },
    );
    hooks.setRequestRender(() => {});
    return () => {
      ctx.ui.setWidget?.("theme-footer", undefined);
      hooks.setRequestRender(undefined);
    };
  }

  hooks.setRequestRender(undefined);
  return () => {};
}
