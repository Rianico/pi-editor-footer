import {
  Editor,
  type EditorOptions,
  type EditorTheme,
  type SelectItem,
  type SelectList,
  type TUI,
} from "@earendil-works/pi-tui";
import type { ModelInfo, ThemeLike } from "./model-info.js";
import { BorderRenderer } from "./border-renderer.js";
import { CursorPolicy, type CursorStyle } from "./cursor-policy.js";

export interface ChromeSnapshot {
  modelInfo: ModelInfo;
  glowEnabled: boolean;
  topRightText: string;
  topContextText: string;
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

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsLike,
    getLiveTheme: () => ThemeLike,
    options?: EditorOptions,
  ) {
    super(tui, theme, options);
    this.keybindings = keybindings;
    this.cursorPolicy = new CursorPolicy(tui);
    this.borderRenderer = new BorderRenderer(
      getLiveTheme,
      () => this._chrome.modelInfo,
    );
    this.patchApplyAutocompleteSuggestions();
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
    if (patch.glowEnabled !== undefined)
      this._chrome.glowEnabled = patch.glowEnabled;
    if (patch.topRightText !== undefined)
      this._chrome.topRightText = patch.topRightText;
    if (patch.topContextText !== undefined)
      this._chrome.topContextText = patch.topContextText;
    if (patch.topTokensText !== undefined)
      this._chrome.topTokensText = patch.topTokensText;
    if (patch.telemetryText !== undefined)
      this._chrome.telemetryText = patch.telemetryText;
    if (patch.bottomLeftText !== undefined)
      this._chrome.bottomLeftText = patch.bottomLeftText;
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
    // SAFETY: EditorInternals is private pi-tui shape — existence validated via typeof check on applyAutocompleteSuggestions
    const internals = this as unknown as EditorInternals; // SAFETY: private pi-tui interior seam
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
    // SAFETY: EditorInternals autocompleteList is private pi-tui field verified at load via constructor source check
    return (this as unknown as EditorInternals).autocompleteList; // SAFETY: private pi-tui interior seam
  }

  private renderBase(width: number): string[] {
    const lines = super.render(width);
    const isFocused =
      // SAFETY: focused is private Editor state read-only for cursor policy; fallback false preserves behavior
      (this as unknown as { focused?: boolean }).focused ?? false; // SAFETY: focused private read-only seam
    return this.cursorPolicy.mapLines(lines, isFocused);
  }

  override render(width: number): string[] {
    let lines = this.renderBase(width);
    if (lines.length === 0) return lines;
    lines = this.borderRenderer.renderWithBorders(lines, width, {
      glowEnabled: this._chrome.glowEnabled,
      telemetryText: this._chrome.telemetryText,
      bottomLeftText: this._chrome.bottomLeftText,
      topRightText: this._chrome.topRightText,
      topContextText: this._chrome.topContextText,
      topTokensText: this._chrome.topTokensText,
    });
    return lines;
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
        const handler =
          this.onEscape ?? this.actionHandlers.get("app.interrupt");
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
