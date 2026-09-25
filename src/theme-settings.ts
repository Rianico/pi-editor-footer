import { Box, Key, matchesKey, SelectList, Text, type TUI } from "@earendil-works/pi-tui";

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
      fn: (tui: TUI, theme: Theme, kb: unknown, done: (v: T) => void) => unknown,
      opts?: unknown,
    ): Promise<T>;
  };
}
import type { ThemeConfig, ConfigTab, ConfigDescriptor } from "./config.js";
import { CONFIG_SCHEMA, descriptorRowId, getByPath, setByPath } from "./config.js";

const TABS: readonly ConfigTab[] = ["general", "appearance", "footer", "telemetry", "timeline"];

export interface SettingItem {
  id: string;
  label: string;
  currentValue: string;
}

const COPY = {
  title: "pi-editor-footer Settings",
  tabs: {
    general: "General",
    appearance: "Appearance",
    footer: "Footer",
    telemetry: "Telemetry",
    timeline: "Timeline",
  },
  hint: "Tab/Shift+Tab/←/→: tabs · ↑/↓: move · Enter/Space: change · Esc/q: close",
  values: {
    on: "On",
    off: "Off",
  },
};

// ---------------------------------------------------------------------------
// Pure settings renderer + reducer over CONFIG_SCHEMA (no TUI) — labels, tabs
// and cycle order live in the descriptor table; ids stay byte-compatible.
// ---------------------------------------------------------------------------

function rowCurrentValue(desc: ConfigDescriptor, config: ThemeConfig): string {
  if (desc.kind === "boolean") {
    return getByPath<boolean>(config, desc.path) ? COPY.values.on : COPY.values.off;
  }
  const value = getByPath<string>(config, desc.path) ?? desc.default;
  return desc.valueLabels?.[value] ?? value;
}

export function settingRowsFor(tab: ConfigTab, config: ThemeConfig): SettingItem[] {
  return CONFIG_SCHEMA.filter((desc) => desc.tab === tab).map((desc) => ({
    id: descriptorRowId(desc),
    label: desc.label,
    currentValue: rowCurrentValue(desc, config),
  }));
}

export function applySettingChange(
  tab: ConfigTab,
  itemId: string,
  config: ThemeConfig,
): ThemeConfig {
  const desc = CONFIG_SCHEMA.find((d) => d.tab === tab && descriptorRowId(d) === itemId);
  if (!desc) return config;
  const next = structuredClone(config);
  if (desc.kind === "boolean") {
    setByPath(next, desc.path, !getByPath<boolean>(next, desc.path));
  } else {
    // cycle in `values` order (the table doubles as the display/cycle order)
    const cur = getByPath<string>(next, desc.path);
    const idx = desc.values.indexOf(cur as string);
    setByPath(next, desc.path, desc.values[(idx + 1) % desc.values.length]!);
  }
  return next;
}

class SettingsUi {
  private tab: ConfigTab = "general";
  private config: ThemeConfig;
  private selectList!: SelectList;
  private readonly selectedItemByTab: Partial<Record<ConfigTab, string>> = {};
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
    this.container = new Box(1, 1, (s: string) => theme.bg("customMessageBg", s));
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
    this.config = applySettingChange(this.tab, itemId, this.config);
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
    this.container.addChild(new Text(this.theme.bold(this.theme.fg("accent", COPY.title)), 1, 0));
    const tabBar = TABS.map((tab) => {
      const active = tab === this.tab;
      const label = active ? `[${COPY.tabs[tab]}]` : ` ${COPY.tabs[tab]} `;
      return active ? this.theme.fg("accent", label) : this.theme.fg("dim", label);
    }).join(" ");
    this.container.addChild(new Text(tabBar, 1, 0));
    this.container.addChild(new Text(this.theme.fg("dim", COPY.hint), 1, 0));

    const items = settingRowsFor(this.tab, this.config).map((item) => ({
      value: item.id,
      label: this.compact ? `${item.label}: ${item.currentValue}` : item.label,
      description: this.compact ? undefined : item.currentValue,
    }));
    this.selectList = new SelectList(items as never, Math.min(items.length, 10), {
      selectedPrefix: (t) => this.theme.fg("accent", t),
      selectedText: (t) => this.theme.fg("accent", t),
      description: (t) => this.theme.fg("muted", t),
      scrollInfo: (t) => this.theme.fg("dim", t),
      noMatch: (t) => this.theme.fg("warning", t),
    });
    const selectedIndex = items.findIndex((item) => item.value === preferredItemId);
    if (selectedIndex >= 0) this.selectList.setSelectedIndex(selectedIndex);
    this.selectedItemByTab[this.tab] = this.selectList.getSelectedItem()?.value;
    this.selectList.onSelectionChange = (item) => {
      this.selectedItemByTab[this.tab] = (item as { value: string }).value;
    };
    this.selectList.onSelect = (item) => this.applySetting((item as { value: string }).value);
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
  pi.registerCommand("pi-editor-footer", {
    description: "Open pi-editor-footer settings (workspace, cursor, footer, telemetry)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
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
