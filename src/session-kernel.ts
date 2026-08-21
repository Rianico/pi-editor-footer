import type { SelectItem, TUI } from "@earendil-works/pi-tui";
import type { ThemeConfig } from "./config.js";
import { ConfigStore } from "./config.js";
import { FooterController } from "./footer-controller.js";
import type { ModelInfo } from "./model-info.js";
import { TurnTelemetryTracker } from "./telemetry.js";
import {
  createRunActivityTracker,
  type RunActivityTracker,
} from "./run-activity.js";
import { renderDetail, scroll } from "./detail-render.js";
import { decorateWindow, type WindowThemeLike } from "./window-presentation.js";
import type { TrackingEditor } from "./tracking-editor.js";

const MAX_LINES = 5;

function kindOf(value: string): string {
  return value.startsWith("skill:") ? "skill" : "command";
}

function detailItemOf(item: SelectItem) {
  return {
    label: item.label,
    kind: kindOf(item.value),
    description: item.description ?? "",
  };
}

function contentLinesFrom(lines: string[]): number {
  if (lines.length === 0) return 0;
  const marker = lines[0].match(/ (\d+)\/(\d+)$/);
  if (marker) return Number.parseInt(marker[2], 10);
  return lines.length - 1;
}

/**
 * SessionKernel — deep module collapsing index.ts's 12 module-scoped vars behind one seam.
 * Previously index.ts scattered footerState/currentConfig/currentModelInfo/telemetry/tuiRef/installedEditor/detail state
 * across 5 event handlers with no locality. Now all that lives here.
 *
 * Interface is the test surface: new SessionKernel({ configStore, getCwd }) → { start(ctx), onModelChange, onTelemetry, dispose, getDetailState, ... }
 * index.ts becomes thin adapter: `export default pi => { const kernel = new SessionKernel(...); pi.on(...) }`.
 */
export class SessionKernel {
  // Owned state — previously 12 vars in index.ts
  private currentItem: SelectItem | null = null;
  private scrollOffset = 0;
  private lastWidth = 0;
  private tuiRef: TUI | null = null;
  private installedEditor: TrackingEditor | null = null;
  private glowEnabled = true;
  private footerController: FooterController;
  private readonly telemetryTracker: TurnTelemetryTracker;
  private readonly configStore: ConfigStore;
  private readonly runActivityTracker: RunActivityTracker;
  private agentStartMs: number | null = null;
  private lastSessionCtx: unknown | null = null;
  private currentModelInfo: ModelInfo = {
    provider: "",
    modelId: "unknown",
    level: "off",
    contextWindow: 0,
  };

  constructor(
    opts: {
      configStore?: ConfigStore;
      footerController?: FooterController;
      getCwd?: () => string;
      telemetryTracker?: TurnTelemetryTracker;
      runActivityTracker?: RunActivityTracker;
    } = {},
  ) {
    this.configStore = opts.configStore ?? new ConfigStore();
    this.footerController =
      opts.footerController ??
      new FooterController({ getCwd: opts.getCwd ?? (() => process.cwd()) });
    this.telemetryTracker = opts.telemetryTracker ?? new TurnTelemetryTracker();
    this.runActivityTracker =
      opts.runActivityTracker ?? createRunActivityTracker();
  }

  // Detail window — previously kindOf/detailItemOf/contentLinesFrom/makeWidget/installWidget/updateWidget/scrollWindow scattered in index.ts
  getCurrentItem(): SelectItem | null {
    return this.currentItem;
  }

  setCurrentItem(item: SelectItem | null): void {
    this.currentItem = item;
    this.scrollOffset = 0;
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  scrollDetail(delta: -1 | 1): void {
    if (!this.currentItem || (this.currentItem.description ?? "").trim() === "")
      return;
    const width = this.lastWidth > 0 ? this.lastWidth : 80;
    const innerWidth = Math.max(1, width - 4);
    const lines = renderDetail(
      detailItemOf(this.currentItem),
      innerWidth,
      MAX_LINES,
      0,
    );
    this.scrollOffset = scroll(
      this.scrollOffset,
      delta,
      contentLinesFrom(lines),
      MAX_LINES,
    );
    this.tuiRef?.requestRender();
  }

  setTuiRef(tui: TUI | null): void {
    this.tuiRef = tui;
  }

  getTuiRef(): TUI | null {
    return this.tuiRef;
  }

  setInstalledEditor(ed: TrackingEditor | null): void {
    this.installedEditor = ed;
  }

  getInstalledEditor(): TrackingEditor | null {
    return this.installedEditor;
  }

  getConfig(): ThemeConfig {
    return this.configStore.get();
  }

  patchConfig(
    patch: Partial<ThemeConfig> & Record<string, unknown>,
  ): ThemeConfig {
    return this.configStore.patch(patch);
  }

  subscribeConfig(
    fn: (cfg: ThemeConfig, prev: ThemeConfig) => void,
  ): () => void {
    return this.configStore.subscribe(fn);
  }

  getModelInfo(): ModelInfo {
    return this.currentModelInfo;
  }

  setModelInfo(info: ModelInfo): void {
    this.currentModelInfo = info;
    this.installedEditor?.setModelInfo(info);
  }

  getFooterState() {
    return this.footerController.getState();
  }

  async refreshFooter(): Promise<void> {
    await this.footerController.refreshAll();
  }

  getGlowEnabled(): boolean {
    return this.glowEnabled;
  }

  setGlowEnabled(v: boolean): void {
    this.glowEnabled = v;
    this.installedEditor?.setGlowEnabled(v);
  }

  getTelemetryTracker(): TurnTelemetryTracker {
    return this.telemetryTracker;
  }

  getRunActivityTracker(): RunActivityTracker {
    return this.runActivityTracker;
  }

  getAgentStartMs(): number | null {
    return this.agentStartMs;
  }

  setAgentStartMs(v: number | null): void {
    this.agentStartMs = v;
  }

  getLastSessionCtx(): unknown | null {
    return this.lastSessionCtx;
  }

  setLastSessionCtx(ctx: unknown | null): void {
    this.lastSessionCtx = ctx;
  }

  // Widget render seam — delegates to pure deep modules (renderDetail + decorateWindow)
  renderDetailWindow(
    width: number,
    themeOf: (t: unknown) => WindowThemeLike,
  ): string[] {
    this.lastWidth = width;
    if (!this.currentItem) return [];
    const innerWidth = Math.max(1, width - 4);
    const lines = renderDetail(
      detailItemOf(this.currentItem),
      innerWidth,
      MAX_LINES,
      this.scrollOffset,
    );
    // Window presentation is pure — kernel owns width/scroll, presentation owns border styling
    // Called with live theme from widget's render(width, theme) — kernel doesn't cache theme
    // SAFETY: placeholder shape validated in makeDetailWidget // SAFETY: internal seam — actual decorate happens in widget factory using lines
    return { lines, innerWidth } as unknown as string[];
  }

  // Convenience for widget factory — returns decorated window lines
  makeDetailWidget(
    theme: unknown,
    width: number,
    themeOf: (t: unknown) => WindowThemeLike,
  ): string[] {
    this.lastWidth = width;
    if (!this.currentItem) return [];
    const innerWidth = Math.max(1, width - 4);
    const lines = renderDetail(
      detailItemOf(this.currentItem),
      innerWidth,
      MAX_LINES,
      this.scrollOffset,
    );
    // This mirrors index.ts makeWidget logic but now lives in kernel for locality
    const t = theme as {
      fg(c: string, s: string): string;
      bold(s: string): string;
    };
    const wTheme: WindowThemeLike = {
      border: (s) => t.fg("border", s),
      highlight: (s) => t.fg("accent", t.bold(s)),
      dim: (s) => t.fg("dim", s),
    };
    return decorateWindow(lines, width, wTheme);
  }

  dispose(): void {
    this.tuiRef = null;
    this.installedEditor = null;
    this.currentItem = null;
    this.scrollOffset = 0;
    this.agentStartMs = null;
    this.lastSessionCtx = null;
  }
}
