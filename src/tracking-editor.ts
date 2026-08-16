import {
  Editor,
  type EditorOptions,
  type EditorTheme,
  type SelectItem,
  type SelectList,
  type TUI,
} from "@earendil-works/pi-tui";

/**
 * Minimal structural view of pi's KeybindingsManager.
 *
 * pi-tui's own `Keybinding` type only covers `tui.*` names, but pi-coding-agent's
 * runtime bindings additionally define `app.*` actions (app.interrupt, app.exit,
 * app.clipboard.pasteImage, ...) which the original CustomEditor matches by string
 * id. Mirror the runtime contract: `matches` accepts any binding id string.
 */
interface KeybindingsLike {
  matches(data: string, keybinding: string): boolean;
}

/** Shape of the popup's suggestion payload passed to applyAutocompleteSuggestions. */
interface AutocompleteSuggestionsLike {
  prefix: string;
  items: SelectItem[];
}

/** The two pi-tui internals this editor observes (ADR-0001, accessed via cast). */
interface EditorInternals {
  autocompleteList?: SelectList;
  applyAutocompleteSuggestions?: (
    suggestions: AutocompleteSuggestionsLike,
    state: "force" | "regular",
  ) => void;
}

/**
 * The input editor for this extension.
 *
 * Replicates pi's CustomEditor exactly (see docs/reference/pi-tui-internals.md)
 * so that interactive mode's setCustomEditorComponent duck-typing wires every app
 * handler onto it, then additionally observes which candidate is highlighted in
 * the native completion popup and reports it through `onHighlight`.
 */
export class TrackingEditor extends Editor {
  keybindings: KeybindingsLike;
  actionHandlers = new Map<string, () => void>();

  // Special handlers that can be dynamically replaced (wired by interactive mode).
  onEscape?: () => void;
  onCtrlD?: () => void;
  onPasteImage?: () => void;
  /** Handler for extension-registered shortcuts. Returns true if handled. */
  onExtensionShortcut?: (data: string) => boolean;

  /** Emits the highlighted completion-popup candidate, or null when the popup is closed. */
  onHighlight?: (item: SelectItem | null) => void;

  /** The last SelectList instance whose onSelectionChange we wired. */
  private lastWiredList?: SelectList;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsLike,
    options?: EditorOptions,
  ) {
    super(tui, theme, options);
    this.keybindings = keybindings;
    this.patchApplyAutocompleteSuggestions();
  }

  /** Register a handler for an app action (used by interactive mode's duck-typing). */
  onAction(action: string, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  /**
   * Instance-patch the (TS-private) `applyAutocompleteSuggestions` so we re-wire
   * the freshly created popup list and report the initial best-match highlight
   * after every suggestion refresh — the programmatic `setSelectedIndex` used
   * there does NOT fire `onSelectionChange`.
   *
   * ADR-0001 blast radius: if pi renames the internals the patch stops firing;
   * we warn loudly at construction instead of failing silently.
   */
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

  /**
   * Emit the current highlight: null when the popup is closed, otherwise the
   * selected item. Also wires `onSelectionChange` on a newly created list.
   */
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

  /** Replication of pi's CustomEditor.handleInput (verbatim logic, plus highlight sync). */
  override handleInput(data: string): void {
    // Check extension-registered shortcuts first.
    if (this.onExtensionShortcut?.(data)) {
      return;
    }
    // Check for clipboard paste keybinding.
    if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
      this.onPasteImage?.();
      return;
    }
    // Escape/interrupt — only if autocomplete is NOT active.
    if (this.keybindings.matches(data, "app.interrupt")) {
      if (!this.isShowingAutocomplete()) {
        // Use dynamic onEscape if set, otherwise registered handler.
        const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
        if (handler) {
          handler();
          return;
        }
      }
      // Let parent handle escape for autocomplete cancellation.
      super.handleInput(data);
      this.syncHighlight(); // escape closes the popup here — report it gone
      return;
    }
    // Exit (Ctrl+D) — only when editor is empty.
    if (this.keybindings.matches(data, "app.exit")) {
      if (this.getText().length === 0) {
        const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
        if (handler) handler();
        return;
      }
      // Fall through to editor handling for delete-char-forward when not empty.
    }
    // Explicit history bindings take precedence over app actions while focused.
    if (
      this.keybindings.matches(data, "tui.editor.historyPrevious") ||
      this.keybindings.matches(data, "tui.editor.historyNext")
    ) {
      super.handleInput(data);
      return;
    }
    // Check all other app actions.
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
    // Pass to parent for editor handling.
    super.handleInput(data);
    this.syncHighlight();
  }
}
