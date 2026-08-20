import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ThemeConfig } from "./config.js";
import type { GitStatus } from "./git.js";
import type { RuntimeInfo } from "./runtime.js";
import type { FooterState, ModelMeta, UsageTotals } from "./state.js";
import { getUsageTotals } from "./state.js";
import type { IconGlyphs } from "./icons.js";
import { resolveGlyphs, resolveIconMode, runtimeSymbol } from "./icons.js";
import {
  alignRight,
  basenamePath,
  cacheHitColor,
  effortColor,
  fitSegmentsByPriority,
  fmtTokens,
  formatCwd,
  formatDuration,
  formatProviderLabel,
  providerColor,
  sanitizeStatus,
  stressColor,
  truncateBranch,
  truncatePath,
  type PrioritizedSegment,
  type Theme,
} from "./utils.js";

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
  const color = stressColor(pct);
  const filledCell = ascii ? "#" : "█";
  const emptyCell = ascii ? "-" : "░";
  return (
    theme.fg("dim", "[") +
    theme.fg(color, filledCell.repeat(filled)) +
    theme.fg("dim", emptyCell.repeat(empty)) +
    theme.fg("dim", "]")
  );
}

function renderGitSegment(
  theme: Theme,
  git: GitStatus,
  glyphs: IconGlyphs,
  segments: ThemeConfig["footerSegments"],
  maxBranchLen = 20,
): string {
  const parts: string[] = [];
  if (segments.gitBranch) {
    if (git.branch) {
      parts.push(theme.fg("mdLink", glyphs.git));
      parts.push(theme.fg("mdLink", truncateBranch(git.branch, maxBranchLen)));
    } else if (git.commit?.detached) {
      parts.push(theme.fg("warning", glyphs.git));
      parts.push(theme.fg("warning", "HEAD"));
      if (git.commit.oid) {
        const shortHash = git.commit.oid.slice(0, 7);
        const tag = git.commit.tag ? ` ${git.commit.tag}` : "";
        parts.push(theme.fg("dim", `${shortHash}${tag}`));
      }
    }
  }

  if (segments.gitStatus) {
    const statusIcons: string[] = [];
    const addStatus = (count: number, glyph: string, color: string) => {
      if (count > 0) statusIcons.push(theme.fg(color, `${glyph}${count}`));
    };
    addStatus(git.conflicted, glyphs.conflicted, "error");
    addStatus(git.deleted, glyphs.deleted, "error");
    addStatus(git.modified, glyphs.modified, "warning");
    addStatus(git.renamed, glyphs.renamed, "warning");
    addStatus(git.staged, glyphs.staged, "success");
    addStatus(git.untracked, glyphs.untracked, "muted");
    addStatus(git.stashed, glyphs.stashed, "muted");

    if (git.ahead > 0 && git.behind > 0) {
      statusIcons.push(
        theme.fg("warning", `${glyphs.diverged}${git.ahead}/${git.behind}`),
      );
    } else if (git.ahead > 0) {
      statusIcons.push(theme.fg("success", `${glyphs.ahead}${git.ahead}`));
    } else if (git.behind > 0) {
      statusIcons.push(theme.fg("warning", `${glyphs.behind}${git.behind}`));
    }

    const statusBlock = statusIcons.join(" ");
    if (statusBlock) {
      parts.push(
        `${theme.fg("dim", "[")}${statusBlock}${theme.fg("dim", "]")}`,
      );
    }
  }

  return parts.join(" ");
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
): string {
  if (state.workingSince !== undefined) {
    return `${theme.fg("accent", glyphs.working)} ${theme.fg("dim", "working")} ${theme.fg("accent", formatDuration(Date.now() - state.workingSince))}`;
  }
  if (state.lastDoneIn !== undefined) {
    return `${theme.fg("success", glyphs.done)} ${theme.fg("success", "done")} ${theme.fg("text", formatDuration(state.lastDoneIn))}`;
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
  const meta = ctx.getModelMeta
    ? ctx.getModelMeta()
    : {
        provider: formatProviderLabel(ctx.model?.provider),
        model: ctx.model?.name ?? ctx.model?.id ?? "no-model",
        effort: undefined as string | undefined,
      };

  const leftParts: PrioritizedSegment[] = [];
  if (segments.cwd) {
    const maxCwd = Math.min(30, Math.max(10, Math.floor(width * 0.4)));
    const rawCwd = formatCwd(ctx.cwd);
    const displayCwd = rawCwd;
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
      leftParts.push({
        text: `${theme.fg("dim", glyphs.session)} ${theme.fg("text", truncateToWidth(sessionName, 24, theme.fg("dim", "...")))}`,
        priority: 2,
      });
    }
  }
  const gitSeg = renderGitSegment(theme, state.git, glyphs, segments);
  if (gitSeg) leftParts.push({ text: gitSeg, priority: 4 });
  if (segments.runtime) {
    const runtimeSeg = renderRuntimeSegment(
      theme,
      state.runtime,
      config.icons.mode,
    );
    if (runtimeSeg) leftParts.push({ text: runtimeSeg, priority: 4 });
  }
  const timerSeg = renderTimerSegment(theme, state, glyphs);
  if (timerSeg) leftParts.push({ text: timerSeg, priority: 1 });

  // Context
  let contextText = "";
  let contextCompact: string | undefined;
  if (segments.context) {
    const contextUsage = ctx.contextUsage;
    const contextWindow = contextUsage?.contextWindow ?? 0;
    if (contextWindow > 0) {
      const contextPct = contextUsage?.percent ?? 0;
      const pctText = theme.fg(
        stressColor(contextPct),
        `${contextPct.toFixed(1)}%`,
      );
      const contextTokens = contextUsage?.tokens ?? 0;
      const ctxText = `${theme.fg("text", fmtTokens(contextTokens))}${theme.fg("dim", "/")}${theme.fg("text", fmtTokens(contextWindow))}`;
      const contextIcon = theme.fg(stressColor(contextPct), glyphs.context);
      const reserved =
        visibleWidth(contextIcon) +
        visibleWidth(pctText) +
        visibleWidth(ctxText) +
        7;
      const barWidth = Math.max(4, Math.min(12, width - reserved));
      contextText = `${contextIcon} ${renderBar(theme, contextPct, barWidth, resolveIconMode(config.icons.mode) === "ascii")} ${pctText} ${theme.fg("dim", "·")} ${ctxText}`;
      const compact = `${theme.fg(stressColor(contextPct), glyphs.context)} ${theme.fg(stressColor(contextPct), `${contextPct.toFixed(1)}%`)}`;
      if (visibleWidth(compact) < visibleWidth(contextText))
        contextCompact = compact;
    }
  }
  const allParts: PrioritizedSegment[] = [...leftParts];
  if (contextText) {
    allParts.push({
      text: contextText,
      compactText: contextCompact,
      priority: 4,
    });
  }

  const fitted = fitSegmentsByPriority(allParts, width, theme.fg("dim", "..."));
  const fittedContext = contextText ? (fitted.pop() ?? "") : "";
  const line1 = alignRight(fitted.join(" "), fittedContext, width, theme);

  const stats: string[] = [];
  if (segments.tokens) {
    stats.push(
      theme.fg("accent", `${glyphs.input} ${fmtTokens(totals.input)}`),
    );
    stats.push(
      theme.fg("success", `${glyphs.output} ${fmtTokens(totals.output)}`),
    );
    const hasCacheTokens = totals.cacheRead > 0 || totals.cacheWrite > 0;
    if (hasCacheTokens && totals.latestCacheHitRate !== undefined) {
      stats.push(
        theme.fg(
          cacheHitColor(totals.latestCacheHitRate),
          `${glyphs.cacheHit} ${totals.latestCacheHitRate.toFixed(1)}%`,
        ),
      );
    }
  }
  if (segments.cost) {
    stats.push(
      theme.fg("warning", `${glyphs.cost} $${totals.cost.toFixed(3)}`),
    );
  }
  const statsBlock = stats.join(` ${theme.fg("dim", "|")} `);

  const line2 = statsBlock;

  const mainLines = (line2 ? [line1, line2] : [line1]).map((line) =>
    truncateToWidth(line, width, theme.fg("dim", "...")),
  );
  if (segments.extensionStatuses && ctx.extensionStatuses) {
    const statuses = Array.from(ctx.extensionStatuses.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, text]) => sanitizeStatus(text))
      .filter((text) => text.length > 0);
    if (statuses.length > 0) {
      const separator = ` ${theme.fg("dim", "|")} `;
      const statusText = statuses
        .map((status) => theme.fg("muted", status))
        .join(separator);
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
      ctx as unknown as {
        sessionManager?: {
          getEntries(): {
            type: string;
            message?: {
              role: string;
              usage?: {
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
                cost?: { total?: number };
              };
            };
          }[];
        };
      },
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
    typeof (ctx.ui as unknown as { setFooter?: unknown }).setFooter ===
    "function"
  ) {
    const ui = ctx.ui as unknown as {
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
          const theme = _theme as unknown as Theme;
          const state = getState();
          const config = getConfig();
          const cwd = ctx.sessionManager?.getCwd() ?? process.cwd();
          const totals = getUsageTotals(
            ctx as unknown as {
              sessionManager?: {
                getEntries(): {
                  type: string;
                  message?: {
                    role: string;
                    usage?: {
                      input?: number;
                      output?: number;
                      cacheRead?: number;
                      cacheWrite?: number;
                      cost?: { total?: number };
                    };
                  };
                }[];
              };
            },
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
      (ctx.ui as unknown as { setFooter: (v: undefined) => void }).setFooter(
        undefined,
      );
    };
  }

  // Fallback: widget belowEditor
  if (ctx.ui.setWidget) {
    const themeForWidget = themeStub;
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
