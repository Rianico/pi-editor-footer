import {
  Editor,
  type EditorOptions,
  type EditorTheme,
  type SelectItem,
  type SelectList,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { resolveThinkingGlow, type ModelInfo, type ThemeLike } from "./model-info.js";
import { planStatusSlot } from "./status-slot.js";
import {
  BorderRenderer,
  EDITOR_FRAME_CHROME,
  editorFramePlan,
  rowsPrependedAboveEditor,
} from "./border-renderer.js";
import { CursorPolicy, type CursorStyle } from "./cursor-policy.js";

/**
 * Structural slice of pi's `StatusIndicator` (status-indicator.js, pi 1.3.0) that
 * the editor needs. Kept structural so this extension never imports pi internals.
 * `message` is private on pi's `Loader` type but is a runtime field — the working
 * segment must echo the indicator's message, never a hardcoded "Working".
 */
export interface EmbeddableStatusIndicator {
  readonly kind?: string;
  readonly message?: string;
  renderInBorder(width: number): string;
  renderSpinnerInBorder(width: number): string;
}

function isWorkingIndicator(indicator: EmbeddableStatusIndicator): boolean {
  return indicator.kind === "working";
}

export interface ChromeSnapshot {
  modelInfo: ModelInfo;
  glowEnabled: boolean;
  topRightText: string;
  topContextText: string;
  topRunTimeText: string;
  topTokensText: string;
  telemetryText: string;
  bottomLeftText: string;
  cursorStyle: CursorStyle;
}

const DEFAULT_CHROME: ChromeSnapshot = {
  modelInfo: {
    provider: "",
    modelId: "unknown",
    level: "off",
    contextWindow: 0,
  },
  glowEnabled: true,
  topRightText: "",
  topContextText: "",
  topRunTimeText: "",
  topTokensText: "",
  telemetryText: "",
  bottomLeftText: "",
  cursorStyle: "block",
};

export type { CursorStyle };

interface KeybindingsLike {
  matches(data: string, keybinding: string): boolean;
}

interface AutocompleteSuggestionsLike {
  prefix: string;
  items: SelectItem[];
}

interface EditorInternals {
  autocompleteList?: SelectList;
  applyAutocompleteSuggestions?: (
    suggestions: AutocompleteSuggestionsLike,
    state: "force" | "regular",
  ) => void;
}

export class TrackingEditor extends Editor {
  keybindings: KeybindingsLike;
  actionHandlers = new Map<string, () => void>();

  onEscape?: () => void;
  onCtrlD?: () => void;
  onPasteImage?: () => void;
  onExtensionShortcut?: (data: string) => boolean;

  onHighlight?: (item: SelectItem | null) => void;

  private lastWiredList?: SelectList;

  private _chrome: ChromeSnapshot = {
    ...DEFAULT_CHROME,
    modelInfo: { ...DEFAULT_CHROME.modelInfo },
  };

  private readonly cursorPolicy: CursorPolicy;
  private readonly borderRenderer: BorderRenderer;

  /**
   * pi's `embedWorkingStatus` contract (CustomEditor parity, pi 1.3.0): claiming it
   * makes pi hand every status indicator to `setWorkingStatusIndicator` instead of
   * pushing its own component above the editor. Working rides the usage row; any
   * other kind is rendered by us as a row above the chrome — never swallowed.
   */
  readonly embedWorkingStatus = true;

  private statusIndicator?: EmbeddableStatusIndicator;
  /** Rows `render` prepended last call — `handleMouse` undoes exactly this shift. */
  private lastPrependedRows = 0;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsLike,
    private readonly getLiveTheme: () => ThemeLike,
    options?: EditorOptions,
  ) {
    super(tui, theme, options);
    this.keybindings = keybindings;
    this.cursorPolicy = new CursorPolicy(tui);
    this.borderRenderer = new BorderRenderer(getLiveTheme, () => this._chrome.modelInfo);
    this.patchApplyAutocompleteSuggestions();
  }

  /**
   * pi seam: last indicator wins, `undefined`/`null` clears it (pi calls this with
   * `undefined` on every `clearStatusIndicator`). pi ignores a return value here,
   * so the editor renders non-working kinds itself below.
   */
  setWorkingStatusIndicator(indicator?: EmbeddableStatusIndicator | null): void {
    this.statusIndicator = indicator ?? undefined;
    this.tui.requestRender();
  }

  /** `⠋ Working` — pi's spinner glyph plus the indicator's own message (ADR-0004 rev 2). */
  private workingStatusText(width: number): string {
    const indicator = this.statusIndicator;
    if (!indicator || !isWorkingIndicator(indicator)) return "";
    const message = typeof indicator.message === "string" ? indicator.message : "";
    if (!message) return indicator.renderInBorder(width).trim();
    const glowFor = resolveThinkingGlow(this.getLiveTheme());
    // pi colours an embedded indicator with the editor border colour (thinking glow)
    const painted = glowFor
      ? glowFor(this._chrome.modelInfo.level, message)
      : this.getLiveTheme().fg("muted", message);
    return `${indicator.renderSpinnerInBorder(width)} ${painted}`;
  }

  /** `● Ready` — the idle counterpart of `⠋ Working`, in the same slot so the status never vanishes. */
  private readyStatusText(): string {
    return this.getLiveTheme().fg("success", "● Ready");
  }

  /** Non-working indicators (retry/compaction/…) stay above the editor, as pi placed them. */
  private statusRowText(width: number): string {
    const indicator = this.statusIndicator;
    if (!indicator || isWorkingIndicator(indicator)) return "";
    return indicator.renderInBorder(width).trim();
  }

  onAction(action: string, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  // ——— Deep interface: one intent replaces 7 setters ———
  /** Deep seam: single entry for all chrome. Callers learn one shape, impl hides composition. */
  setChrome(patch: Partial<ChromeSnapshot>): void {
    let cursorChanged = false;
    const prevCursor = this._chrome.cursorStyle;
    if (patch.modelInfo !== undefined) this._chrome.modelInfo = patch.modelInfo;
    if (patch.glowEnabled !== undefined) this._chrome.glowEnabled = patch.glowEnabled;
    if (patch.topRightText !== undefined) this._chrome.topRightText = patch.topRightText;
    if (patch.topContextText !== undefined) this._chrome.topContextText = patch.topContextText;
    if (patch.topRunTimeText !== undefined) this._chrome.topRunTimeText = patch.topRunTimeText;
    if (patch.topTokensText !== undefined) this._chrome.topTokensText = patch.topTokensText;
    if (patch.telemetryText !== undefined) this._chrome.telemetryText = patch.telemetryText;
    if (patch.bottomLeftText !== undefined) this._chrome.bottomLeftText = patch.bottomLeftText;
    if (patch.cursorStyle !== undefined) {
      this._chrome.cursorStyle = patch.cursorStyle;
      cursorChanged = prevCursor !== patch.cursorStyle;
    }
    if (cursorChanged) this.cursorPolicy.setStyle(this._chrome.cursorStyle);
    this.tui.requestRender();
  }

  getChrome(): ChromeSnapshot {
    return { ...this._chrome, modelInfo: { ...this._chrome.modelInfo } };
  }

  // Deep interface is setChrome/getChrome only — wrappers removed (C4). All chrome via setChrome({})
  private patchApplyAutocompleteSuggestions(): void {
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: EditorInternals is private pi-tui shape — existence validated via typeof check on applyAutocompleteSuggestions
    /* SAFETY: intentional unsafe cast — validated at runtime */ const internals =
      this as unknown as EditorInternals; // SAFETY: private pi-tui interior seam
    const original = internals.applyAutocompleteSuggestions;
    if (typeof original !== "function") {
      console.warn(
        "[pi-skill-desc] pi-tui internals changed: `applyAutocompleteSuggestions` not found on Editor — highlight tracking disabled.",
      );
      return;
    }
    internals.applyAutocompleteSuggestions = (suggestions, state) => {
      original.call(this, suggestions, state);
      this.syncHighlight();
    };
  }

  private syncHighlight(): void {
    const list = this.currentAutocompleteList();
    if (!list) {
      this.onHighlight?.(null);
      return;
    }
    if (list !== this.lastWiredList) {
      this.lastWiredList = list;
      list.onSelectionChange = (item) => this.onHighlight?.(item);
    }
    this.onHighlight?.(list.getSelectedItem());
  }

  private currentAutocompleteList(): SelectList | undefined {
    // ast-grep-ignore: require-safety-comment-for-as-unknown-as
    // SAFETY: EditorInternals autocompleteList is private pi-tui field verified at load via constructor source check
    /* SAFETY: intentional unsafe cast — validated at runtime */ return (
      this as unknown as EditorInternals
    ).autocompleteList; // SAFETY: private pi-tui interior seam
  }

  private renderBody(width: number): string[] {
    const lines = super.render(width);
    const isFocused =
      // SAFETY: focused is private Editor state read-only for cursor policy; fallback false preserves behavior
      // ast-grep-ignore: require-safety-comment-for-as-unknown-as
      // SAFETY: focused is private Editor state read-only for cursor policy; fallback false preserves behavior
      // biome-ignore format: keep SAFETY comment directly before cast for ast-grep
      /* SAFETY: intentional unsafe cast — validated at runtime */ (
        this as unknown as { focused?: boolean }
      ).focused ?? false;
    return this.cursorPolicy.mapLines(lines, isFocused);
  }

  override render(width: number): string[] {
    // The frame spends EDITOR_FRAME_CHROME columns on rails + inner padding, so the
    // body is rendered at bodyWidth — wrapping, the caret and the scroll window are
    // all computed against the columns the text actually gets.
    const plan = editorFramePlan(width);
    let lines = this.renderBody(plan.bodyWidth);
    if (lines.length === 0) return lines;
    const indicator = this.statusIndicator;
    const statusSlot = planStatusSlot({
      hasIndicator: Boolean(indicator),
      indicatorIsWorking: Boolean(indicator && isWorkingIndicator(indicator)),
      hasUsageRow: Boolean(this._chrome.topTokensText || this._chrome.topRightText),
    });
    const workingText =
      statusSlot === "working"
        ? this.workingStatusText(width)
        : statusSlot === "ready"
          ? this.readyStatusText()
          : "";
    const statusLineText = this.statusRowText(width);
    this.lastPrependedRows = rowsPrependedAboveEditor({
      statusRow: statusLineText !== "",
      usageRow: Boolean(workingText || this._chrome.topTokensText || this._chrome.topRightText),
    });
    lines = this.borderRenderer.renderWithBorders(lines, width, {
      glowEnabled: this._chrome.glowEnabled,
      telemetryText: this._chrome.telemetryText,
      bottomLeftText: this._chrome.bottomLeftText,
      topRightText: this._chrome.topRightText,
      topContextText: this._chrome.topContextText,
      topRunTimeText: this._chrome.topRunTimeText,
      topTokensText: this._chrome.topTokensText,
      workingText,
      statusLineText,
    });
    return lines;
  }

  /**
   * Undo the token row that `render` prepends above the editor's own top border.
   *
   * `Editor.handleMouse` (pi-tui 1.3.0) indexes rows relative to its own output —
   * `[top border][content…][bottom border][autocomplete…]` — so a shifted row would
   * land the cursor one logical line off, and clicks on the tokens/top-border rows
   * would be read as the first content line. pi-tui before 1.3.0 has no editor mouse
   * handling at all, so the base method may be absent at runtime.
   */
  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const parentHandleMouse: unknown = super.handleMouse;
    if (typeof parentHandleMouse !== "function") return undefined;
    const prependedRows = this.lastPrependedRows;
    const prepared = (event: { y: number; x: number; width: number }): TuiMouseEvent => {
      const plan = editorFramePlan(event.width);
      const railColumns = plan.framed ? EDITOR_FRAME_CHROME / 2 : 0;
      return {
        ...event,
        x: event.x - railColumns,
        width: plan.bodyWidth,
        y: event.y - prependedRows,
      } as TuiMouseEvent;
    };
    const shifted = prepared(event);
    return (parentHandleMouse as (e: TuiMouseEvent) => TuiMouseEventResult | undefined).call(
      this,
      shifted,
    );
  }

  override handleInput(data: string): void {
    if (this.onExtensionShortcut?.(data)) {
      return;
    }
    if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
      this.onPasteImage?.();
      return;
    }
    if (this.keybindings.matches(data, "app.interrupt")) {
      if (!this.isShowingAutocomplete()) {
        const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
        if (handler) {
          handler();
          return;
        }
      }
      super.handleInput(data);
      this.syncHighlight();
      return;
    }
    if (this.keybindings.matches(data, "app.exit")) {
      if (this.getText().length === 0) {
        const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
        if (handler) handler();
        return;
      }
    }
    if (
      this.keybindings.matches(data, "tui.editor.historyPrevious") ||
      this.keybindings.matches(data, "tui.editor.historyNext")
    ) {
      super.handleInput(data);
      return;
    }
    for (const [action, handler] of this.actionHandlers) {
      if (
        action !== "app.interrupt" &&
        action !== "app.exit" &&
        this.keybindings.matches(data, action)
      ) {
        handler();
        return;
      }
    }
    super.handleInput(data);
    this.syncHighlight();
  }
}
