import {
  Box,
  Key,
  matchesKey,
  SelectList,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

type Theme = {
  bg(style: string, s: string): string;
  fg(style: string, s: string): string;
  bold(s: string): string;
  dim(s: string): string;
  muted(s: string): string;
};
interface ExtensionAPI {
  registerCommand(
    name: string,
    opts: {
      description?: string;
      handler: (args: string, ctx: ExtensionContext) => void | Promise<void>;
    },
  ): void;
}
interface ExtensionContext {
  hasUI?: boolean;
  ui: {
    custom<T>(
      fn: (
        tui: TUI,
        theme: Theme,
        kb: unknown,
        done: (v: T) => void,
      ) => unknown,
      opts?: unknown,
    ): Promise<T>;
  };
}
import type { ThemeConfig, CursorStyle, IconMode } from "./config.ts";

const TABS = ["general", "appearance", "footer", "telemetry"] as const;
type Tab = (typeof TABS)[number];

interface SettingItem {
  id: string;
  label: string;
  currentValue: string;
}

const COPY = {
  title: "pi-lsz-theme Settings",
  tabs: {
    general: "General",
    appearance: "Appearance",
    footer: "Footer",
    telemetry: "Telemetry",
  },
  hint: "Tab/Shift+Tab/←/→: tabs · ↑/↓: move · Enter/Space: change · Esc/q: close",
  labels: {
    enabled: "Enabled",
    workspaceDisplay: "Workspace display",
    cursorStyle: "Cursor style",
    iconMode: "Icon mode",
    cwd: "CWD",
    sessionName: "Session name",
    gitBranch: "Git branch",
    gitStatus: "Git status",
    gitCommit: "Git commit (detached)",
    runtime: "Runtime",
    context: "Context bar",
    tokens: "Tokens",
    cost: "Cost",
    extensionStatuses: "Extension status line",
    tps: "TPS",
    ttft: "TTFT",
    duration: "Total duration",
    stallDetails: "Stall details",
    costRate: "Cost rate",
  },
  values: {
    on: "On",
    off: "Off",
    workspace: { path: "Path", name: "Name" } as Record<
      ThemeConfig["workspaceDisplay"],
      string
    >,
    cursorStyles: {
      block: "Block",
      bar: "Bar",
      underline: "Underline",
    } as Record<CursorStyle, string>,
    icons: { auto: "Auto", nerd: "Nerd", ascii: "ASCII" } as Record<
      IconMode,
      string
    >,
  },
};

function toggleWorkspace(config: ThemeConfig): ThemeConfig {
  return {
    ...config,
    workspaceDisplay: config.workspaceDisplay === "path" ? "name" : "path",
  };
}
function cycleCursor(config: ThemeConfig): ThemeConfig {
  const order: CursorStyle[] = ["block", "bar", "underline"];
  const idx = order.indexOf(config.cursorStyle);
  const next = order[(idx + 1) % order.length]!;
  return { ...config, cursorStyle: next };
}
function cycleIconMode(config: ThemeConfig): ThemeConfig {
  const order: IconMode[] = ["auto", "nerd", "ascii"];
  const idx = order.indexOf(config.icons.mode);
  const next = order[(idx + 1) % order.length]!;
  return { ...config, icons: { mode: next } };
}
function toggleFlag<K extends keyof ThemeConfig["footerSegments"]>(
  config: ThemeConfig,
  key: K,
): ThemeConfig {
  return {
    ...config,
    footerSegments: {
      ...config.footerSegments,
      [key]: !config.footerSegments[key],
    },
  };
}
function toggleTelemetry<K extends keyof ThemeConfig["telemetry"]>(
  config: ThemeConfig,
  key: K,
): ThemeConfig {
  if (key === "enabled") {
    // keep sub-flags as-is when toggling enabled, but allow it
    return {
      ...config,
      telemetry: { ...config.telemetry, enabled: !config.telemetry.enabled },
    };
  }
  return {
    ...config,
    telemetry: { ...config.telemetry, [key]: !config.telemetry[key] },
  };
}

function buildGeneralItems(config: ThemeConfig): SettingItem[] {
  return [
    {
      id: "enabled",
      label: COPY.labels.enabled,
      currentValue: config.enabled ? COPY.values.on : COPY.values.off,
    },
    {
      id: "workspaceDisplay",
      label: COPY.labels.workspaceDisplay,
      currentValue: COPY.values.workspace[config.workspaceDisplay],
    },
    {
      id: "cursorStyle",
      label: COPY.labels.cursorStyle,
      currentValue: COPY.values.cursorStyles[config.cursorStyle],
    },
  ];
}
function buildAppearanceItems(config: ThemeConfig): SettingItem[] {
  return [
    {
      id: "iconMode",
      label: COPY.labels.iconMode,
      currentValue: COPY.values.icons[config.icons.mode],
    },
  ];
}
function buildFooterItems(config: ThemeConfig): SettingItem[] {
  const segs = config.footerSegments;
  const flag = (v: boolean) => (v ? COPY.values.on : COPY.values.off);
  return [
    { id: "cwd", label: COPY.labels.cwd, currentValue: flag(segs.cwd) },
    {
      id: "sessionName",
      label: COPY.labels.sessionName,
      currentValue: flag(segs.sessionName),
    },
    {
      id: "gitBranch",
      label: COPY.labels.gitBranch,
      currentValue: flag(segs.gitBranch),
    },
    {
      id: "gitStatus",
      label: COPY.labels.gitStatus,
      currentValue: flag(segs.gitStatus),
    },
    {
      id: "gitCommit",
      label: COPY.labels.gitCommit,
      currentValue: flag(segs.gitCommit),
    },
    {
      id: "runtime",
      label: COPY.labels.runtime,
      currentValue: flag(segs.runtime),
    },
    {
      id: "context",
      label: COPY.labels.context,
      currentValue: flag(segs.context),
    },
    {
      id: "tokens",
      label: COPY.labels.tokens,
      currentValue: flag(segs.tokens),
    },
    { id: "cost", label: COPY.labels.cost, currentValue: flag(segs.cost) },
    {
      id: "extensionStatuses",
      label: COPY.labels.extensionStatuses,
      currentValue: flag(segs.extensionStatuses),
    },
  ];
}
function buildTelemetryItems(config: ThemeConfig): SettingItem[] {
  const t = config.telemetry;
  const flag = (v: boolean) => (v ? COPY.values.on : COPY.values.off);
  return [
    {
      id: "enabled",
      label: COPY.labels.enabled,
      currentValue: flag(t.enabled),
    },
    { id: "tps", label: COPY.labels.tps, currentValue: flag(t.tps) },
    { id: "ttft", label: COPY.labels.ttft, currentValue: flag(t.ttft) },
    {
      id: "duration",
      label: COPY.labels.duration,
      currentValue: flag(t.duration),
    },
    { id: "tokens", label: COPY.labels.tokens, currentValue: flag(t.tokens) },
    {
      id: "stalls",
      label: COPY.labels.stallDetails,
      currentValue: flag(t.stalls),
    },
    { id: "cost", label: COPY.labels.costRate, currentValue: flag(t.cost) },
  ];
}
function buildItems(tab: Tab, config: ThemeConfig): SettingItem[] {
  switch (tab) {
    case "general":
      return buildGeneralItems(config);
    case "appearance":
      return buildAppearanceItems(config);
    case "footer":
      return buildFooterItems(config);
    case "telemetry":
      return buildTelemetryItems(config);
  }
}

function handleSettingChange(
  tab: Tab,
  itemId: string,
  config: ThemeConfig,
): ThemeConfig {
  if (tab === "general") {
    if (itemId === "enabled") return { ...config, enabled: !config.enabled };
    if (itemId === "workspaceDisplay") return toggleWorkspace(config);
    if (itemId === "cursorStyle") return cycleCursor(config);
  }
  if (tab === "appearance") {
    if (itemId === "iconMode") return cycleIconMode(config);
  }
  if (tab === "footer") {
    return toggleFlag(config, itemId as keyof ThemeConfig["footerSegments"]);
  }
  if (tab === "telemetry") {
    return toggleTelemetry(config, itemId as keyof ThemeConfig["telemetry"]);
  }
  return config;
}

class SettingsUi {
  private tab: Tab = "general";
  private config: ThemeConfig;
  private selectList!: SelectList;
  private readonly selectedItemByTab: Partial<Record<Tab, string>> = {};
  private readonly container: Box;
  private readonly theme: Theme;
  private readonly onChange: (config: ThemeConfig) => void;
  private readonly onClose: () => void;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;
  private compact = false;

  constructor(
    theme: Theme,
    config: ThemeConfig,
    onChange: (config: ThemeConfig) => void,
    onClose: () => void,
  ) {
    this.theme = theme;
    this.config = config;
    this.onChange = onChange;
    this.onClose = onClose;
    this.container = new Box(1, 1, (s: string) =>
      theme.bg("customMessageBg", s),
    );
    this.selectList = new SelectList([], 12, {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    this.rebuild();
  }

  private applySetting(itemId: string): void {
    this.selectedItemByTab[this.tab] = itemId;
    this.config = handleSettingChange(this.tab, itemId, this.config);
    this.onChange(this.config);
    this.rebuild(itemId);
  }

  private switchTab(offset: number): void {
    const idx = TABS.indexOf(this.tab);
    this.tab = TABS[(idx + offset + TABS.length) % TABS.length]!;
    this.rebuild();
  }

  private rebuild(preferredItemId = this.selectedItemByTab[this.tab]): void {
    this.container.clear();
    this.container.addChild(
      new Text(this.theme.bold(this.theme.fg("accent", COPY.title)), 1, 0),
    );
    const tabBar = TABS.map((tab) => {
      const active = tab === this.tab;
      const label = active ? `[${COPY.tabs[tab]}]` : ` ${COPY.tabs[tab]} `;
      return active
        ? this.theme.fg("accent", label)
        : this.theme.fg("dim", label);
    }).join(" ");
    this.container.addChild(new Text(tabBar, 1, 0));
    this.container.addChild(new Text(this.theme.fg("dim", COPY.hint), 1, 0));

    const items = buildItems(this.tab, this.config).map((item) => ({
      value: item.id,
      label: this.compact ? `${item.label}: ${item.currentValue}` : item.label,
      description: this.compact ? undefined : item.currentValue,
    }));
    this.selectList = new SelectList(
      items as never,
      Math.min(items.length, 10),
      {
        selectedPrefix: (t) => this.theme.fg("accent", t),
        selectedText: (t) => this.theme.fg("accent", t),
        description: (t) => this.theme.fg("muted", t),
        scrollInfo: (t) => this.theme.fg("dim", t),
        noMatch: (t) => this.theme.fg("warning", t),
      },
    );
    const selectedIndex = items.findIndex(
      (item) => item.value === preferredItemId,
    );
    if (selectedIndex >= 0) this.selectList.setSelectedIndex(selectedIndex);
    this.selectedItemByTab[this.tab] = this.selectList.getSelectedItem()?.value;
    this.selectList.onSelectionChange = (item) => {
      this.selectedItemByTab[this.tab] = (item as { value: string }).value;
    };
    this.selectList.onSelect = (item) =>
      this.applySetting((item as { value: string }).value);
    this.selectList.onCancel = () => this.onClose();
    this.container.addChild(this.selectList as never);
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.switchTab(1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
      this.switchTab(-1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.space) || data === " ") {
      const selected = this.selectList.getSelectedItem();
      if (selected) this.applySetting((selected as { value: string }).value);
    } else {
      this.selectList.handleInput?.(data);
    }
    this.invalidate();
  }

  render(width: number): string[] {
    const compact = width <= 60;
    if (compact !== this.compact) {
      this.compact = compact;
      this.rebuild();
    }
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedWidth = width;
    this.cachedLines = this.container.render(width);
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.container.invalidate();
  }
}

export function registerThemeSettingsCommand(
  pi: any,
  hooks: {
    getConfig: () => ThemeConfig;
    onConfigChanged: (config: ThemeConfig) => void;
    onOverlayClosed?: () => void;
  },
): void {
  pi.registerCommand("pi-lsz-theme", {
    description:
      "Open pi-lsz-theme settings (workspace, cursor, footer, telemetry)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
      // Also expose as /theme for backwards compat — the dialog is the same
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: unknown, done: (v: void) => void) => {
          const ui = new SettingsUi(
            theme as Theme,
            hooks.getConfig(),
            (config) => hooks.onConfigChanged(config),
            () => done(undefined),
          );
          return {
            render: (w: number) => ui.render(w),
            invalidate: () => ui.invalidate(),
            handleInput: (data: string) => {
              ui.handleInput(data);
              tui.requestRender();
            },
          };
        },
        { overlay: true },
      );
      hooks.onOverlayClosed?.();
    },
  });

  // keep /theme as alias that also opens the window (so typing /theme same as /pi-lsz-theme window)
  pi.registerCommand("theme", {
    description: "Open pi-lsz-theme settings",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
      // delegate by invoking the same custom UI — avoid recursion
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: unknown, done: (v: void) => void) => {
          const ui = new SettingsUi(
            theme as Theme,
            hooks.getConfig(),
            (config) => hooks.onConfigChanged(config),
            () => done(undefined),
          );
          return {
            render: (w: number) => ui.render(w),
            invalidate: () => ui.invalidate(),
            handleInput: (data: string) => {
              ui.handleInput(data);
              tui.requestRender();
            },
          };
        },
        { overlay: true },
      );
      hooks.onOverlayClosed?.();
    },
  });
}
