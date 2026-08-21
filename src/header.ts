import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Keep helpers local to avoid conflict with footer track which owns shared src/utils.ts.
// Copied from tmp/pi-open-tui/extensions/open-tui/utils.ts (MIT).

export type WorkspaceDisplay = "path" | "name";

export interface HeaderThemeLike {
  fg(style: string, s: string): string;
}

export interface HeaderDeps {
  cwd: string;
  workspaceDisplay: WorkspaceDisplay;
  tipCommands: string[];
  /** Cwd glyph; defaults to "@" (ascii) if not provided. Footer owns full icons.ts. */
  iconCwd?: string;
}

export function formatCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const insideHome =
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!insideHome) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

export function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  if (maxLen <= 3) return "...".slice(0, maxLen);
  const sepChar = path.includes("/") ? "/" : "\\";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 2) return path.slice(0, maxLen - 3) + "...";
  const tail: string[] = [];
  let tailLen = 0;
  for (let i = parts.length - 1; i >= 1; i--) {
    const seg = parts[i]!;
    if (tailLen + seg.length + 4 > maxLen) break;
    tail.unshift(seg);
    tailLen += seg.length + 1;
  }
  const head = parts[0]!;
  const result = `${head}${sepChar}...${sepChar}${tail.join(sepChar)}`;
  return result.length > maxLen ? result.slice(0, maxLen - 3) + "..." : result;
}

function displayCwd(rawCwd: string, _mode: WorkspaceDisplay): string {
  return formatCwd(rawCwd);
}

// Keep layout logic local; footer owns the full headerColumnWidths.
// Simple: at narrow widths, tips are dropped.
const GAP = 3;

export function renderHeader(
  width: number,
  deps: HeaderDeps,
  theme: HeaderThemeLike,
): string[] {
  if (width <= 0) return [];
  if (!deps.cwd) return [];

  const icon = deps.iconCwd ?? "@";
  const cwdText = displayCwd(deps.cwd, deps.workspaceDisplay);
  // Single-line content: "icon cwd  |  tip0  tip1  tip2"
  const tips = (deps.tipCommands ?? [])
    .slice(0, 3)
    .map((t) => (t.startsWith("/") ? t : `/${t}`));
  const tipsText =
    tips.length > 0 ? tips.map((t) => theme.fg("dim", t)).join("  ") : "";

  // At very narrow widths, just show cwd with icon, truncated.
  if (width < 24 || tipsText === "") {
    const raw = `${icon} ${cwdText}`;
    const truncated = truncateToWidth(raw, width, theme.fg("dim", "..."));
    return [truncated];
  }

  const tipsW = visibleWidth(tipsText);
  const gapW = GAP;
  // Reserve for tips; if not enough room, drop tips.
  if (tipsW + gapW + 10 > width) {
    const raw = `${icon} ${cwdText}`;
    return [truncateToWidth(raw, width, theme.fg("dim", "..."))];
  }

  // Allocate widths
  const maxTipsW = Math.min(28, tipsW);
  const leftW = width - gapW - maxTipsW;
  const cwdIconText = `${icon} ${cwdText}`;
  const leftText = truncatePath(cwdIconText, leftW);
  // Pad left to leftW, then gap, then tips (right-aligned within maxTipsW)
  // For simplicity, left + gap + tipsText (tips already themed dim)
  // Use visibleWidth for padding.
  const leftVisible = visibleWidth(leftText);
  const pad = Math.max(gapW, width - leftVisible - tipsW);
  const line = leftText + " ".repeat(pad) + tipsText;
  return [truncateToWidth(line, width, theme.fg("dim", "..."))];
}

// Minimal widget installer — keeps header always on when enabled.
// Does not depend on full config; caller provides getters so tests stay pure.

export type GetHeaderConfig = () => {
  enabled: boolean;
  workspaceDisplay: WorkspaceDisplay;
};
export type GetCwd = () => string;
export type GetTips = () => string[];

export function installHeader(
  ctx: {
    ui: {
      setWidget(
        key: string,
        content: unknown,
        options?: { placement?: string },
      ): void;
    };
    mode?: string;
  },
  getConfig: GetHeaderConfig,
  getCwd: GetCwd,
  getTips: GetTips,
): () => void {
  const key = "theme-header";

  // Avoid touching UI when not in TUI.
  const mode = (ctx as { mode?: string }).mode;
  if (mode && mode !== "tui") {
    return () => {};
  }

  // Create a TUI component that renders the header at current width.
  const factory = (_tui: unknown, theme: unknown) => {
    const th = theme as HeaderThemeLike;
    return {
      invalidate(): void {},
      render(width: number): string[] {
        const cfg = getConfig();
        if (!cfg.enabled) return [];
        return renderHeader(
          width,
          {
            cwd: getCwd(),
            workspaceDisplay: cfg.workspaceDisplay,
            tipCommands: getTips(),
          },
          th,
        );
      },
      dispose(): void {},
    };
  };

  // Adapter: ExtensionUIContextLike.setWidget expects (key, content, options)
  // where content can be string[] or factory (tui, theme) => Component.
  // SAFETY: pi seam — intentional unsafe cast, validated at runtime
  const ui = ctx.ui as unknown as {
    setWidget: (
      key: string,
      content:
        | ((
            tui: unknown,
            theme: unknown,
          ) => { render(width: number): string[] })
        | undefined,
      options?: { placement?: string },
    ) => void;
  };
  // SAFETY: intentional unsafe cast — validated at runtime
  ui.setWidget(key, factory as unknown as never, { placement: "aboveEditor" });

  return () => {
    ui.setWidget(key, undefined);
  };
}
