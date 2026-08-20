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

  glowEnabled = true;

  private lastWiredList?: SelectList;

  private modelInfo: ModelInfo = {
    provider: "",
    modelId: "unknown",
    level: "off",
    contextWindow: 0,
  };

  private readonly cursorPolicy: CursorPolicy;
  private readonly borderRenderer: BorderRenderer;
  private telemetryText = "";
  private bottomLeftText = "";
  private topRightText = "";

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
      () => this.modelInfo,
    );
    this.patchApplyAutocompleteSuggestions();
  }

  onAction(action: string, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  setModelInfo(info: ModelInfo): void {
    this.modelInfo = info;
    this.tui.requestRender();
  }

  setGlowEnabled(enabled: boolean): void {
    this.glowEnabled = enabled;
    this.tui.requestRender();
  }

  setCursorStyle(style: CursorStyle): void {
    const prev = this.cursorPolicy.getStyle();
    this.cursorPolicy.setStyle(style);
    if (prev === style) this.tui.requestRender();
    else this.tui.requestRender();
  }

  getCursorStyle(): CursorStyle {
    return this.cursorPolicy.getStyle();
  }

  setTelemetryText(text: string): void {
    this.telemetryText = text;
    this.tui.requestRender();
  }

  setBottomLeftText(text: string): void {
    this.bottomLeftText = text;
    this.tui.requestRender();
  }

  getBottomLeftText(): string {
    return this.bottomLeftText;
  }

  getTelemetryText(): string {
    return this.telemetryText;
  }

  setTopRightText(text: string): void {
    this.topRightText = text;
    this.tui.requestRender();
  }

  getTopRightText(): string {
    return this.topRightText;
  }
  private patchApplyAutocompleteSuggestions(): void {
    const internals = this as unknown as EditorInternals;
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
    return (this as unknown as EditorInternals).autocompleteList;
  }

  private renderBase(width: number): string[] {
    const lines = super.render(width);
    const isFocused =
      (this as unknown as { focused?: boolean }).focused ?? false;
    return this.cursorPolicy.mapLines(lines, isFocused);
  }

  override render(width: number): string[] {
    let lines = this.renderBase(width);
    if (lines.length === 0) return lines;
    lines = this.borderRenderer.renderWithBorders(lines, width, {
      glowEnabled: this.glowEnabled,
      telemetryText: this.telemetryText,
      bottomLeftText: this.bottomLeftText,
      topRightText: this.topRightText,
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
