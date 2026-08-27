/**
 * SessionOrchestrator — deep module owning the entire extension lifecycle behind one seam.
 *
 * Previously src/index.ts (897 lines) scattered 15 pi.on handlers, 8+ mutable lets,
 * 3× footer install duplication (session_start ×2 + onConfigChanged enabled toggle),
 * detail→widget globals (currentItem/scrollOffset/lastWidth/tuiRef), watchdog timer,
 * and timeline derivation across globals with no locality. Changing one border
 * segment touched 6 call sites; fixing footer install required holding 3 copies
 * in one head — shallow.
 *
 * Depth: small interface (install / dispose) hides coalesced lifecycle
 * (deferred editor install + watchdog ownership + footer lifecycle single path +
 *  detail→widget + timeline ledger delegation). Callers learn one shape.
 * Impl hides LiveBorder, AgentRunLedger, DetailChrome, ChromeComposition,
 * and the footer install deduplication. Two adapters (real pi TUI + in-memory
 * fake) justify the seam — tests hit one interface.
 */

import {
  Editor,
  type Component,
  type EditorComponent,
  type EditorTheme,
  type KeybindingsManager,
  type SelectItem,
  type TUI,
  Text,
} from "@earendil-works/pi-tui";
import { TrackingEditor } from "./tracking-editor.js";
import { installFooter } from "./footer.js";
import { createInitialState, getUsageTotals } from "./state.js";
import type { FooterState } from "./state.js";
import { TurnTelemetryTracker, formatTurnTelemetry } from "./telemetry.js";
import { createRunActivityTracker } from "./run-activity.js";
import type { RunActivityTracker } from "./run-activity.js";
import { readGitStatus } from "./git.js";
import { readRuntimeInfo } from "./runtime.js";
import { DetailChrome } from "./detail-chrome.js";
import type { ModelInfo, ThemeLike } from "./model-info.js";
import { loadConfig, saveConfig } from "./config.js";
import type { ThemeConfig } from "./config.js";
import { registerThemeSettingsCommand } from "./theme-settings.js";
import { resolveGlyphs } from "./icons.js";
import { TranscriptTimeline } from "./transcript-timeline.js";
import { LiveBorder } from "./live-border.js";
import {
  AgentRunLedger,
  estimateTokensFromText,
  estimateTokensFromChars,
} from "./agent-run-ledger.js";

// Minimal pi ExtensionAPI slice — duplicated from index to avoid circular import.
// Authoritative types live in @earendil-works/pi-coding-agent.
export interface ExtensionWidgetOptionsLike {
  placement?: "aboveEditor" | "belowEditor";
}
export interface ExtensionUIContextLike {
  setEditorComponent(
    factory: (
      tui: TUI,
      theme: EditorTheme,
      keybindings: KeybindingsManager,
    ) => EditorComponent,
  ): void;
  setWidget(
    key: string,
    content:
      | string[]
      | ((tui: TUI, theme: unknown) => Component & { dispose?(): void })
      | undefined,
    options?: ExtensionWidgetOptionsLike,
  ): void;
  readonly theme: ThemeLike;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}
export interface ExtensionContextLike {
  mode: string;
  ui: ExtensionUIContextLike;
  model?: { provider?: string; id?: string; contextWindow?: number };
  thinkingLevel?: string;
}
export interface ExtensionAPILike {
  on(
    event: "session_start",
    handler: (event: unknown, ctx: ExtensionContextLike) => void,
  ): void;
  on(
    event: "model_select",
    handler: (event: unknown, ctx: ExtensionContextLike) => void,
  ): void;
  on(
    event: "thinking_level_select",
    handler: (event: unknown, ctx: ExtensionContextLike) => void,
  ): void;
  on(
    event: "session_shutdown",
    handler: (event: unknown, ctx: ExtensionContextLike) => void,
  ): void;
  on(
    event: string,
    handler: (event: unknown, ctx: ExtensionContextLike) => void,
  ): void;
  registerShortcut(
    shortcut: string,
    options: { description?: string; handler: () => void },
  ): void;
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (
        args: string,
        ctx: ExtensionContextLike,
      ) => void | Promise<void>;
    },
  ): void;
}

export const REFRESH_MS = 1000;

/** Extract text from pi message content (string | array of parts) for token estimation (chars/4). */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // SAFETY: pi message content seam — parts are {type/text} or {text} shapes
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
          if (typeof p.input === "string") return p.input;
        }
        return "";
      })
      .join("\n");
  }
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
  }
  return "";
}

function extractTriggerTokensFromCtx(ctx: unknown): number {
  try {
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    const entries =
      (
        ctx as unknown as { sessionManager?: { getEntries(): unknown[] } }
      )?.sessionManager?.getEntries?.() ?? []; // SAFETY: pi seam
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as Record<string, unknown>;
      if (e.type !== "message") continue;
      const msg = e.message as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "user") continue;
      const text = extractTextFromContent(msg.content);
      if (text.length > 0) return estimateTokensFromText(text);
      // Fallback: stringify content length
      const fallback =
        typeof msg.content === "string"
          ? msg.content.length
          : JSON.stringify(msg.content ?? "").length;
      return estimateTokensFromChars(fallback);
    }
  } catch {
    // SAFETY: best-effort, ignore recoverable error
  }
  return 0;
}

function extractToolResultText(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const ev = e as Record<string, unknown>;
  // Common shapes: {result: string}, {result: {content}}, {output}, {content}, {text}
  if (typeof ev.result === "string") return ev.result;
  if (ev.result && typeof ev.result === "object") {
    const r = ev.result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content;
    if (typeof r.text === "string") return r.text;
    if (Array.isArray(r.content)) return extractTextFromContent(r.content);
    try {
      return JSON.stringify(r);
    } catch {
      return "";
    }
  }
  if (typeof ev.output === "string") return ev.output;
  if (typeof ev.content === "string") return ev.content;
  if (typeof ev.text === "string") return ev.text;
  if (Array.isArray(ev.content)) return extractTextFromContent(ev.content);
  return "";
}

function modelInfoOf(ctx: ExtensionContextLike): ModelInfo {
  return {
    provider: ctx.model?.provider ?? "",
    modelId: ctx.model?.id ?? "unknown",
    level: ctx.thinkingLevel ?? "off",
    contextWindow: ctx.model?.contextWindow ?? 0,
  };
}

function assertInternals(): void {
  const missing: string[] = [];
  // SAFETY: pi seam — intentional unsafe cast, validated at runtime
  const proto = Editor.prototype as unknown as Record<string, unknown>;
  if (typeof proto.applyAutocompleteSuggestions !== "function") {
    missing.push("applyAutocompleteSuggestions (method)");
  }
  if (!Editor.prototype.constructor.toString().includes("autocompleteList")) {
    missing.push("autocompleteList (field)");
  }
  if (missing.length > 0) {
    console.warn(
      `[pi-skill-desc] pi-tui internals changed — highlight tracking may be broken ` +
        `(missing: ${missing.join(", ")}). See docs/adr/0001-tracking-editor-for-skill-descriptions.md.`,
    );
  }
}

export interface SessionOrchestratorDeps {
  loadConfig?: () => ThemeConfig;
  saveConfig?: (
    patch: Partial<ThemeConfig> & Record<string, unknown>,
  ) => ThemeConfig;
  createInitialState?: () => FooterState;
}

export class SessionOrchestrator {
  // ——— owned state — previously 15+ module-scoped lets in index.ts ———
  private tuiRef: TUI | null = null;
  private shortcutsRegistered = false;
  private glowEnabled = true;
  private footerCleanup: (() => void) | null = null;
  private installedEditor: TrackingEditor | null = null;
  private lastSessionCtx: ExtensionContextLike | null = null;
  private extensionPi: unknown = null;
  private currentConfig: ThemeConfig;
  private readonly telemetryTracker: TurnTelemetryTracker;
  private readonly runActivityTracker: RunActivityTracker;
  private readonly agentLedger: AgentRunLedger;
  private readonly detailChrome: DetailChrome;
  private readonly liveBorder: LiveBorder;
  private readonly transcriptTimeline: TranscriptTimeline;
  private footerState: FooterState;
  private agentStartMs: number | null = null;
  private agentBaselineTotals: ReturnType<typeof getUsageTotals> | null = null;
  private currentModelInfo: ModelInfo = {
    provider: "",
    modelId: "unknown",
    level: "off",
    contextWindow: 0,
  };
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private deferredInstallTimer: ReturnType<typeof setTimeout> | null = null;
  private headerCleanupInner: (() => void) | null = null;
  private readonly saveConfigFn: (
    patch: Partial<ThemeConfig> & Record<string, unknown>,
  ) => ThemeConfig;

  constructor(deps: SessionOrchestratorDeps = {}) {
    this.currentConfig = (deps.loadConfig ?? loadConfig)();
    this.saveConfigFn = deps.saveConfig ?? saveConfig;
    this.footerState = (deps.createInitialState ?? createInitialState)();
    this.telemetryTracker = new TurnTelemetryTracker();
    this.runActivityTracker = createRunActivityTracker();
    this.agentLedger = new AgentRunLedger();
    this.detailChrome = new DetailChrome();
    this.transcriptTimeline = new TranscriptTimeline({
      // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      getLastSessionCtx: () => this.lastSessionCtx as unknown,
      getTuiRef: () => this.tuiRef,
    });
    this.liveBorder = new LiveBorder({
      getEditor: () => this.installedEditor,
      getCtx: () =>
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        this.lastSessionCtx as unknown as ExtensionContextLike | null,
      getConfig: () => this.currentConfig,
      telemetryTracker: this.telemetryTracker,
      runActivityTracker: this.runActivityTracker,
      agentLedger: this.agentLedger,
    });
    assertInternals();
  }

  // ——— public seam ———

  /** Register all pi handlers and commands. One call, one seam. */
  install(pi: ExtensionAPILike): void {
    this.extensionPi = pi;
    this.registerCommands(pi);
    this.registerPiHandlers(pi);
  }

  /** Teardown timers and state. Called on session_shutdown. */
  dispose(): void {
    this.transcriptTimeline.clear();
    this.agentStartMs = null;
    this.agentBaselineTotals = null;
    this.agentLedger.setBaseline(null);
    this.agentLedger.reset();
    this.footerState = {
      ...this.footerState,
      workingSince: undefined,
      lastDoneIn: undefined,
    };
    this.liveBorder.stopTick();
    this.runActivityTracker.reset();
    this.installedEditor?.setChrome({ topRightText: "" });
    this.lastSessionCtx = null;
    this.headerCleanupInner?.();
    this.headerCleanupInner = null;
    this.footerCleanup?.();
    this.footerCleanup = null;
    if (this.deferredInstallTimer !== null) {
      clearTimeout(this.deferredInstallTimer);
      this.deferredInstallTimer = null;
    }
    if (this.watchTimer !== null) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  // ——— accessors for tests ———

  getConfig(): ThemeConfig {
    return this.currentConfig;
  }
  getFooterState(): FooterState {
    return this.footerState;
  }
  getDetailChrome(): DetailChrome {
    return this.detailChrome;
  }
  getLiveBorder(): LiveBorder {
    return this.liveBorder;
  }
  getTranscriptTimeline(): TranscriptTimeline {
    return this.transcriptTimeline;
  }
  getAgentLedger(): AgentRunLedger {
    return this.agentLedger;
  }
  getCurrentModelInfo(): ModelInfo {
    return this.currentModelInfo;
  }
  getTuiRef(): TUI | null {
    return this.tuiRef;
  }
  getInstalledEditor(): TrackingEditor | null {
    return this.installedEditor;
  }

  // ——— widget ———

  private makeWidget(ctx: ExtensionUIContextLike): Component {
    return {
      invalidate(): void {},
      render: (width: number): string[] => {
        return this.detailChrome.render(width, ctx.theme);
      },
    };
  }

  private installWidget(ctx: ExtensionUIContextLike): void {
    ctx.setWidget(
      "pi-skill-desc",
      (tui) => {
        this.tuiRef = tui;
        return this.makeWidget(ctx);
      },
      { placement: "aboveEditor" },
    );
  }

  private removeWidget(ctx: ExtensionUIContextLike): void {
    ctx.setWidget("pi-skill-desc", undefined);
  }

  private updateWidget(ctx: ExtensionUIContextLike): void {
    if (this.detailChrome.hasContent()) this.installWidget(ctx);
    else this.removeWidget(ctx);
    this.tuiRef?.requestRender();
  }

  private scrollWindow(delta: -1 | 1): void {
    this.detailChrome.scrollBy(delta);
    this.tuiRef?.requestRender();
  }

  // ——— timeline — via TranscriptTimeline single seam ———

  // ——— editor ownership ———

  private installEditor(ctx: ExtensionUIContextLike): void {
    ctx.setEditorComponent((tui, theme, keybindings) => {
      const editor = new TrackingEditor(
        tui,
        theme,
        keybindings,
        () => ctx.theme,
      );
      this.installedEditor = editor;
      editor.setChrome({ modelInfo: this.currentModelInfo });
      editor.setChrome({ glowEnabled: this.glowEnabled });
      editor.setChrome({ cursorStyle: this.currentConfig.cursorStyle });
      this.refreshContextBar();
      editor.onHighlight = (item) => {
        this.detailChrome.setItem(item);
        this.updateWidget(ctx);
      };
      return editor;
    });
  }

  private ensureEditorOwnership(ctx: ExtensionUIContextLike): void {
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    const tui = this.tuiRef as unknown as {
      getFocusedComponent?: () => unknown;
    } | null;
    const focused = tui?.getFocusedComponent?.();
    if (focused === null || focused === undefined) return;
    const maybeEditor = focused as {
      handleInput?: unknown;
      actionHandlers?: unknown;
    };
    const isInputEditor =
      typeof maybeEditor.handleInput === "function" &&
      maybeEditor.actionHandlers instanceof Map;
    if (isInputEditor && focused !== this.installedEditor) {
      this.installEditor(ctx);
    }
  }

  // ——— live border ———

  private refreshContextBar(): void {
    this.liveBorder.render();
  }
  private refreshTopBorder(): void {
    this.liveBorder.render();
  }
  private refreshLiveTelemetry(): void {
    this.liveBorder.render();
  }

  // ——— footer lifecycle — single path, deduplicated ———

  private ensureFooter(ctx: ExtensionContextLike): void {
    if (!this.currentConfig.enabled) {
      this.removeFooter();
      return;
    }
    try {
      this.footerCleanup?.();
      this.footerCleanup = installFooter(
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        ctx as unknown as Parameters<typeof installFooter>[0],
        () => this.footerState,
        () => this.currentConfig,
        () => ({
          provider: this.currentModelInfo.provider,
          model: this.currentModelInfo.modelId,
          effort: this.currentModelInfo.level,
        }),
        {
          setRequestRender: (fn) => {
            // SAFETY: pi seam — intentional unsafe cast, validated at runtime
            (
              globalThis as unknown as { __footerRender?: () => void }
            ).__footerRender = fn ?? undefined; // SAFETY: pi seam
          },
          scheduleGitRefresh: () => {
            void (async () => {
              try {
                // SAFETY: pi seam — intentional unsafe cast, validated at runtime
                const cwd =
                  // SAFETY: pi seam — intentional unsafe cast, validated at runtime
                  (
                    ctx as unknown as {
                      sessionManager?: { getCwd: () => string };
                    }
                  ).sessionManager // SAFETY: pi seam
                    ?.getCwd?.() ??
                  // SAFETY: pi seam — intentional unsafe cast, validated at runtime
                  (ctx as unknown as { cwd?: string }).cwd ??
                  process.cwd();
                const git = await readGitStatus(cwd);
                this.footerState = { ...this.footerState, git } as FooterState;
                this.refreshContextBar();
                // SAFETY: pi seam — intentional unsafe cast, validated at runtime
                (
                  globalThis as unknown as { __footerRender?: () => void }
                ).__footerRender?.();
                const runtime = await readRuntimeInfo(cwd);
                this.footerState = {
                  ...this.footerState,
                  runtime,
                } as FooterState;
                // SAFETY: pi seam — intentional unsafe cast, validated at runtime
                (
                  globalThis as unknown as { __footerRender?: () => void }
                ).__footerRender?.();
              } catch (_e) {
                void _e; // SAFETY: best-effort UI, ignore recoverable error
              }
            })();
          },
        },
      );
    } catch (_e) {
      void _e; // SAFETY: best-effort UI, ignore recoverable error
    }
    void (async () => {
      try {
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        const cwd =
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          (
            ctx as unknown as { sessionManager?: { getCwd: () => string } }
          ).sessionManager // SAFETY: pi seam
            ?.getCwd?.() ??
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          (ctx as unknown as { cwd?: string }).cwd ??
          process.cwd();
        const git = await readGitStatus(cwd);
        this.footerState = { ...this.footerState, git } as FooterState;
        this.refreshContextBar();
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        (
          globalThis as unknown as { __footerRender?: () => void }
        ).__footerRender?.();
        const runtime = await readRuntimeInfo(cwd);
        this.footerState = { ...this.footerState, runtime } as FooterState;
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        (
          globalThis as unknown as { __footerRender?: () => void }
        ).__footerRender?.();
      } catch (_e) {
        void _e; // SAFETY: best-effort UI, ignore recoverable error
      }
    })();
    this.installedEditor?.setChrome({
      cursorStyle: this.currentConfig.cursorStyle,
    });
    this.refreshContextBar();
  }

  private removeFooter(): void {
    this.footerCleanup?.();
    this.footerCleanup = null;
    // SAFETY: pi seam — intentional unsafe cast, validated at runtime
    (globalThis as unknown as { __footerRender?: () => void }).__footerRender =
      undefined;
  }

  // ——— commands ———

  private registerCommands(pi: ExtensionAPILike): void {
    pi.registerCommand("model-info", {
      description: "Toggle the model label + glow on the input border",
      handler: async (_args, ctx) => {
        this.glowEnabled = !this.glowEnabled;
        this.installedEditor?.setChrome({ glowEnabled: this.glowEnabled });
        ctx.ui.notify(
          `Model info border ${this.glowEnabled ? "shown" : "hidden"}`,
          "info",
        );
      },
    });

    registerThemeSettingsCommand(pi, {
      getConfig: () => this.currentConfig,
      onConfigChanged: (cfg) => {
        const prevEnabled = this.currentConfig.enabled;
        this.currentConfig = this.saveConfigFn(
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          cfg as unknown as Partial<ThemeConfig>,
        ); // SAFETY: pi seam
        if (prevEnabled !== this.currentConfig.enabled) {
          if (!this.currentConfig.enabled) {
            this.removeFooter();
          } else if (this.lastSessionCtx) {
            this.ensureFooter(this.lastSessionCtx);
          }
        }
        this.installedEditor?.setChrome({
          cursorStyle: this.currentConfig.cursorStyle,
        });
        this.refreshContextBar();
        this.refreshLiveTelemetry();
        this.tuiRef?.requestRender();
      },
      onOverlayClosed: () => {
        this.tuiRef?.requestRender();
      },
    });

    // Timeline custom entry renderer
    try {
      // SAFETY: pi entry renderer is public API — timeline entries are TUI-only, not sent to LLM

      // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      (
        pi as unknown as {
          registerEntryRenderer?: (t: string, r: unknown) => void;
        }
      ).registerEntryRenderer?.(
        "timeline",
        (entry: unknown, _opts: unknown, theme: unknown) => {
          const data = (entry as { data?: { text?: string } }).data;
          const text = data?.text ?? "";
          const lines = text.split("\n").map((l: string) => {
            try {
              return (theme as { fg: (c: string, s: string) => string }).fg(
                "dim",
                " " + l,
              );
            } catch {
              // SAFETY: best-effort, ignore recoverable error
              return " " + l;
            }
          });
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          return new Text(lines.join("\n")) as unknown as Component;
        },
      );
    } catch {
      // SAFETY: best-effort, ignore recoverable error
    }
  }

  // ——— pi event wiring ———

  private registerPiHandlers(pi: ExtensionAPILike): void {
    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui") return;
      if (!this.shortcutsRegistered) {
        this.shortcutsRegistered = true;
        pi.registerShortcut("shift+up", {
          description: "Scroll the pi-skill-desc detail window up",
          handler: () => this.scrollWindow(-1),
        });
        pi.registerShortcut("shift+down", {
          description: "Scroll the pi-skill-desc detail window down",
          handler: () => this.scrollWindow(1),
        });
        pi.registerShortcut("alt+j", {
          description: "Scroll the pi-skill-desc detail window up (fallback)",
          handler: () => this.scrollWindow(-1),
        });
        pi.registerShortcut("alt+k", {
          description: "Scroll the pi-skill-desc detail window down (fallback)",
          handler: () => this.scrollWindow(1),
        });
      }
      this.currentModelInfo = modelInfoOf(ctx);
      this.lastSessionCtx = ctx;
      this.agentBaselineTotals = null;
      this.agentLedger.setBaseline(null);
      this.agentLedger.reset();
      this.liveBorder.setAgentBaseline(null);
      this.deferredInstallTimer = setTimeout(
        () => this.installEditor(ctx.ui),
        0,
      );
      this.ensureFooter(ctx);
      if (this.watchTimer !== null) clearInterval(this.watchTimer);
      this.watchTimer = setInterval(
        () => this.ensureEditorOwnership(ctx.ui),
        REFRESH_MS,
      );
    });

    pi.on("session_shutdown", () => {
      this.dispose();
    });

    const getToolCallId = (e: unknown): string => {
      const ev = e as Record<string, unknown>;
      return (
        (ev.toolCallId as string) ??
        (ev.toolCallID as string) ??
        ((ev.toolCall as Record<string, unknown>)?.id as string) ??
        ""
      );
    };
    const getToolIsError = (e: unknown): boolean => {
      const ev = e as Record<string, unknown>;
      if (typeof ev.isError === "boolean") return ev.isError;
      if (typeof ev.success === "boolean") return !ev.success;
      const result = ev.result as Record<string, unknown> | undefined;
      if (result && typeof result.isError === "boolean") return result.isError;
      return false;
    };
    const refreshAllLive = (): void => {
      this.liveBorder.render();
    };

    pi.on("agent_start", (e, ctx) => {
      this.telemetryTracker.handle(e as never);
      this.runActivityTracker.startRun();
      try {
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        const baselineCtx = (ctx ??
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          this.lastSessionCtx) as unknown as Parameters<
          typeof getUsageTotals
        >[0];
        if (baselineCtx?.sessionManager?.getEntries) {
          this.agentBaselineTotals = getUsageTotals(baselineCtx);
          this.agentLedger.setBaseline(this.agentBaselineTotals);
          this.agentLedger.startRun(Date.now());
          this.agentLedger.setTriggerTokens(
            extractTriggerTokensFromCtx(ctx ?? this.lastSessionCtx),
          );
          this.liveBorder.setAgentBaseline(this.agentBaselineTotals);
        }
      } catch {
        // SAFETY: best-effort, ignore recoverable error
      }
      this.agentStartMs = Date.now();
      this.footerState = {
        ...this.footerState,
        workingSince: this.agentStartMs,
        lastDoneIn: undefined,
      };
      this.liveBorder.startTick();
      refreshAllLive();
    });

    pi.on("agent_end", (e) => {
      this.telemetryTracker.handle(e as never);
      this.runActivityTracker.settle();
    });

    pi.on("turn_start", (e, _ctx) => {
      void _ctx;
      // Per-agent_run incremental: trigger + Σ(outputs+tools) — each agent_run independent (Q1/Q9)
      const syntheticInput = this.agentLedger.getSyntheticCompletedInput();
      if (syntheticInput > 0) {
        (e as { inputTokens?: number }).inputTokens =
          Math.round(syntheticInput); // SAFETY: turn_start input estimate seam
      } else if (syntheticInput === 0) {
        (e as { inputTokens?: number }).inputTokens = 0; // SAFETY: turn_start input estimate seam — Q11 a fallback 0
      }
      this.telemetryTracker.handle(e as never);
      if (syntheticInput >= 0) {
        this.telemetryTracker.setTurnInputEstimate(syntheticInput);
      }
      const turnIdx = (e as { turnIndex?: number })?.turnIndex ?? 0;
      this.runActivityTracker.startTurn(turnIdx);
      this.liveBorder.startTick();
      refreshAllLive();
    });

    pi.on("before_provider_request", () => {
      refreshAllLive();
    });
    pi.on("message_start", (e) => {
      this.telemetryTracker.handle(e as never);
      refreshAllLive();
    });
    pi.on("message_update", (e) => {
      this.telemetryTracker.handle(e as never);
    });
    pi.on("message_end", (e) => {
      this.telemetryTracker.handle(e as never);
      refreshAllLive();
    });
    pi.on("tool_execution_start", (e) => {
      this.telemetryTracker.handle(e as never);
      this.runActivityTracker.startTool(getToolCallId(e));
      refreshAllLive();
    });
    pi.on("tool_execution_end", (e) => {
      const text = extractToolResultText(e);
      if (text.length > 0)
        this.agentLedger.addToolResultTokens(estimateTokensFromText(text));
      this.runActivityTracker.finishTool(getToolCallId(e), getToolIsError(e));
      refreshAllLive();
    });
    pi.on("tool_result", (e) => {
      const text = extractToolResultText(e);
      if (text.length > 0)
        this.agentLedger.addToolResultTokens(estimateTokensFromText(text));
      this.runActivityTracker.finishTool(getToolCallId(e), getToolIsError(e));
      refreshAllLive();
    });
    pi.on("turn_end", (e) => {
      const tel = this.telemetryTracker.handle(e as never);
      if (tel) this.agentLedger.recordTurn(tel);
      refreshAllLive();
    });

    pi.on("agent_settled", (e, c) => {
      const tel = this.telemetryTracker.handle(e as never);
      const settledFromLedger = this.agentLedger.getSettledTotals();
      // SAFETY: pi seam — intentional unsafe cast, validated at runtime
      const effectiveTel =
        // SAFETY: pi seam — intentional unsafe cast, validated at runtime
        (tel as unknown as
          | import("./telemetry.js").TurnTelemetry
          | null
          | undefined) ?? settledFromLedger;
      this.runActivityTracker.settle();
      this.liveBorder.stopTick();
      if (this.agentStartMs === null) {
        this.footerState = { ...this.footerState, workingSince: undefined };
      } else {
        const doneIn = Date.now() - this.agentStartMs;
        this.footerState = {
          ...this.footerState,
          workingSince: undefined,
          lastDoneIn: doneIn,
        };
        this.agentStartMs = null;
      }
      try {
        if (
          this.lastSessionCtx &&
          this.footerState.lastDoneIn !== undefined &&
          this.currentConfig.timeline.enabled
        ) {
          const totals = getUsageTotals(
            // SAFETY: pi seam — intentional unsafe cast, validated at runtime
            this.lastSessionCtx as unknown as Parameters<
              typeof getUsageTotals
            >[0], // SAFETY: pi seam
          );
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          const ctxTokens =
            (this.lastSessionCtx as ExtensionContextLike & {
                getContextUsage?: () => { tokens?: number };
              }
            )?.getContextUsage?.()?.tokens;
          const snap = this.runActivityTracker.getSnapshot();
          this.transcriptTimeline.handleAgentSettled(
            // SAFETY: pi seam — intentional unsafe cast, validated at runtime
            this.lastSessionCtx.ui as unknown as ExtensionUIContextLike,
            this.extensionPi,
            {
              effectiveTel,
              totals,
              ctxTokens,
              snap,
              config: this.currentConfig,
              lastDoneIn: this.footerState.lastDoneIn!,
              ledger: this.agentLedger,
            },
          );
        }
      } catch {
        // SAFETY: best-effort, ignore recoverable error
      }
      if (
        effectiveTel &&
        this.installedEditor &&
        this.currentConfig.telemetry.enabled
      ) {
        try {
          // SAFETY: pi seam — intentional unsafe cast, validated at runtime
          const themeArg = (c as unknown as { ui?: { theme?: unknown } })?.ui
            ?.theme; // SAFETY: pi seam
          const glyphs = resolveGlyphs(this.currentConfig.icons.mode);
          const right = formatTurnTelemetry(
            effectiveTel,
            themeArg as never,
            this.currentConfig.telemetry,
            glyphs as never,
          );
          this.installedEditor.setChrome({ telemetryText: right });
          this.installedEditor.setChrome({ bottomLeftText: "" });
        } catch (_e) {
          void _e; // SAFETY: best-effort UI, ignore recoverable error
        }
      } else if (
        this.installedEditor &&
        !this.currentConfig.telemetry.enabled
      ) {
        try {
          this.installedEditor.setChrome({ telemetryText: "" });
          this.installedEditor.setChrome({ bottomLeftText: "" });
        } catch (_e) {
          void _e; // SAFETY: best-effort UI, ignore recoverable error
        }
      }
      this.agentLedger.reset();
      this.refreshTopBorder();
    });

    pi.on("model_select", (_event, ctx) => {
      if (ctx.mode !== "tui") return;
      this.currentModelInfo = modelInfoOf(ctx);
      this.lastSessionCtx = ctx;
      // Reset TPS history on model switch — different models, different speeds (pi-core-tps-stats parity)
      this.telemetryTracker.reset();
      this.installedEditor?.setChrome({ modelInfo: this.currentModelInfo });
    });
    pi.on("thinking_level_select", (_event, ctx) => {
      if (ctx.mode !== "tui") return;
      this.currentModelInfo = modelInfoOf(ctx);
      this.lastSessionCtx = ctx;
      this.installedEditor?.setChrome({ modelInfo: this.currentModelInfo });
    });
  }
}
