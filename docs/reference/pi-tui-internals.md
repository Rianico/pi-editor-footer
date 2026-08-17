# pi-tui internals reference (verified against installed packages)

Implementation reference for the Detail-window extension. All facts below were verified by reading the **installed** packages on 2026-08-16:

- `@earendil-works/pi-coding-agent` — dist types + interactive-mode source
- `@earendil-works/pi-tui` **v0.84.2** — dist source

Pin dev dependency `@earendil-works/pi-tui@0.84.2` for types. The extension imports at runtime only from `@earendil-works/pi-tui` (pi provides it).

## Extension model

- Extensions are TypeScript modules with a **default-exported factory**: `export default function (pi: ExtensionAPI): void | Promise<void>`.
- Auto-discovered from `~/.pi/agent/extensions/` or `.pi/extensions/` (project), or `pi -e ./path.ts`.
- `ExtensionAPI` members used here: `registerShortcut(KeyId, {description?, handler(ctx)})`, `on(event, handler)`, `getAllTools()`, `getCommands()`.
- Event handlers receive `ctx: ExtensionContext` with `ctx.ui: ExtensionUIContext` and `ctx.mode` (`"tui"` guards terminal-only UI).

## ExtensionUIContext members (verified in dist/core/extensions/types.d.ts)

- `setWidget(key, content, options?)` where `content` is `string[]` or a component factory `(tui, theme) => Component & {dispose?()}`; `options.placement: "aboveEditor" | "belowEditor"` (default aboveEditor).
- `setStatus(key, text | undefined)` — status/footer text.
- `custom<T>(factory, {overlay?, overlayOptions?, onHandle?})` — focus-taking overlay (not used by this extension).
- `onTerminalInput(handler): unsubscribe` — raw keystrokes before the focused component; `{consume}` / `{data}`.
- `setEditorComponent(factory | undefined)` where `factory = (tui, theme, keybindings) => EditorComponent`.
- `addAutocompleteProvider(factory)` — stacks on the built-in provider (data only; no selection signal).

## The editor contract (pi-tui EditorComponent)

`EditorComponent` interface: `getText()/setText()/handleInput(data)/onSubmit?/onChange?/addToHistory?/insertTextAtCursor?/getExpandedText?/setAutocompleteProvider?/borderColor?/setPaddingX?/setAutocompleteMaxVisible?`.

`Editor` class is **exported** from `@earendil-works/pi-tui`: `constructor(tui, theme, options?: EditorOptions)`; `EditorOptions = { paddingX?, autocompleteMaxVisible? }`. Public methods used: `getText()`, `setText()`, `isShowingAutocomplete()`, `onSubmit`, `onChange`, `setAutocompleteProvider`, `handleInput`.

## How pi's CustomEditor works (replicate exactly)

pi's interactive mode uses `CustomEditor extends Editor` (`dist/modes/interactive/components/custom-editor.js`). Full source:

```ts
import { Editor } from "@earendil-works/pi-tui";

export class CustomEditor extends Editor {
    keybindings;
    actionHandlers = new Map();
    onEscape;
    onCtrlD;
    onPasteImage;
    /** Handler for extension-registered shortcuts. Returns true if handled. */
    onExtensionShortcut;
    constructor(tui, theme, keybindings, options) {
        super(tui, theme, options);
        this.keybindings = keybindings;
    }
    onAction(action, handler) { this.actionHandlers.set(action, handler); }
    handleInput(data) {
        if (this.onExtensionShortcut?.(data)) return;
        if (this.keybindings.matches(data, "app.clipboard.pasteImage")) { this.onPasteImage?.(); return; }
        if (this.keybindings.matches(data, "app.interrupt")) {
            if (!this.isShowingAutocomplete()) {
                const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
                if (handler) { handler(); return; }
            }
            super.handleInput(data);
            return;
        }
        if (this.keybindings.matches(data, "app.exit")) {
            if (this.getText().length === 0) {
                const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
                if (handler) handler();
                return;
            }
        }
        if (this.keybindings.matches(data, "tui.editor.historyPrevious") ||
            this.keybindings.matches(data, "tui.editor.historyNext")) {
            super.handleInput(data);
            return;
        }
        for (const [action, handler] of this.actionHandlers) {
            if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
                handler();
                return;
            }
        }
        super.handleInput(data);
    }
}
```

## setEditorComponent wiring (dist/modes/interactive/interactive-mode.js `setCustomEditorComponent`)

The factory is called `factory(this.ui, getEditorTheme(), this.keybindings)`. After creation, interactive mode **duck-types**: if the new editor has an `actionHandlers` property that is a `Map`, it copies all app-level handlers onto it — `onEscape`, `onCtrlD`, `onPasteImage`, `onExtensionShortcut` (falling back to the default editor's), and every entry of the default editor's `actionHandlers` map. It also wires `onSubmit`, `onChange`, copies text and appearance, and calls `setAutocompleteProvider` when supported.

→ A custom editor with `actionHandlers = new Map()` + `onAction(action, handler)` + the fields above behaves identically to the default editor.

## The autocomplete popup internals (pi-tui components/editor.js + components/select-list.js)

- The popup is a `SelectList` stored in the private field **`autocompleteList`**.
- The list is (re)created in the private method **`applyAutocompleteSuggestions(suggestions, state)`** — the only construction site:

  ```ts
  applyAutocompleteSuggestions(suggestions, state) {
      this.autocompletePrefix = suggestions.prefix;
      this.autocompleteList = this.createAutocompleteList(suggestions.prefix, suggestions.items);
      const bestMatchIndex = this.getBestAutocompleteMatchIndex(suggestions.items, suggestions.prefix);
      if (bestMatchIndex >= 0) this.autocompleteList.setSelectedIndex(bestMatchIndex);
      this.autocompleteState = state;
  }
  ```

- `clearAutocompleteUi()` sets `autocompleteList = undefined`, `autocompleteState = null`.
- Editor `handleInput` delegates to `this.autocompleteList.handleInput(data)` while the popup is open (up/down/tab/enter).
- `SelectList` is exported from pi-tui. Public members: `onSelectionChange?: (item: SelectItem) => void` (**left unwired by the editor — ours to use**), `getSelectedItem(): SelectItem | null`, `setSelectedIndex(index)`, `handleInput(keyData)`, `render(width)`, `setFilter(filter)`.
- `SelectList.handleInput` fires `notifySelectionChange()` on up/down (wraps around), which calls `onSelectionChange(selectedItem)`. Programmatic `setSelectedIndex` (initial best-match) does **not** fire it — read `getSelectedItem()` after wiring.
- `SelectItem = { value, label, description? }` — the description is the **full, untruncated** text (truncation is display-only). Slash-command items carry `description`; file-completion items may not.

**Tracking recipe**: subclass `Editor`; in the constructor, instance-patch `applyAutocompleteSuggestions` (cast to `any` — TS-private) so that after each `super.applyAutocompleteSuggestions(...)` call you wire `list.onSelectionChange` on the fresh list and emit the current `getSelectedItem()`; in an overridden `handleInput`, call `super.handleInput(data)` then read `(this as any).autocompleteList` — wire if new, and emit `getSelectedItem()` (or `null` when the popup is closed, i.e. the field is undefined). Emit through a public `onHighlight?: (item: SelectItem | null) => void` property.

**Blast radius (ADR-0001)**: two internal names — `autocompleteList` (field) and `applyAutocompleteSuggestions` (method). Verify both exist at extension load and warn loudly if not.

## Keybindings

- `pi.registerShortcut(shortcut: KeyId, {description?, handler(ctx)})`; `KeyId` strings like `"shift+up"`, `"shift+down"`.
- `shift+up` / `shift+down` are **unbound** in pi's defaults and not in the reserved list → free to register. (`ctrl+shift+up/down` = alt-screen prompt nav, `alt+up` = dequeue — avoid.)
- Conflict policy: reserved keys are silently skipped with a warning; non-reserved bound keys are overridden with a warning; unbound keys are clean.
- `matchesKey(data, "shift+up")` handles Kitty modified-arrow sequences (`\x1b[1;2A`). Terminals without modified-arrow reporting alias shift+arrows to plain arrows — scroll degrades to no-op.

## Data

- The completion popup lists slash commands, templates, extension commands, and skills (`skill:<name>`, description = SKILL.md frontmatter, prefixed with source info). **Tools never appear** — they are agent-invoked, not slash-invocable.
- No catalog lookups needed: the highlighted `SelectItem` carries its own full description.

## Sync contract — keeping the editor current with pi updates

This extension **replaces pi's default input editor** via `setEditorComponent`. `TrackingEditor` (`src/tracking-editor.ts`) is the actual editor in the input box: it replicates pi's `CustomEditor` inline and reads two private pi-tui internals — so **pi editor changes are NOT inherited automatically.** On every pi update, and whenever pi adds or changes editor behaviour, sync manually:

1. **Diff the replicated base.** Compare pi's `CustomEditor` (`dist/modes/interactive/components/custom-editor.js` in `@earendil-works/pi-coding-agent` — source in the "How pi's CustomEditor works" section above) and pi-tui's `Editor` (`components/editor.js` in `@earendil-works/pi-tui`) against `src/tracking-editor.ts`: port any new/changed app-keybinding branches, fields, or methods in `handleInput`; keep the highlight-sync additions after each `super.handleInput(data)`.
2. **Check the private internals.** Confirm `autocompleteList` and `applyAutocompleteSuggestions` still exist with the same names on pi-tui's `Editor`. The load-time `assertInternals()` in `src/index.ts` warns if they vanish — if it warns, fix the tracking in `src/tracking-editor.ts`, don't silence the warning.
3. **Verify live** with the scripted pty loop (the only seam for the editor wiring): from the repo root,
   `(sleep 18; printf '/'; sleep 1.5; printf '\033[B'; sleep 2; printf '\033'; sleep 2) | timeout 45 script -q /tmp/psd.log pi -e ./src/index.ts --no-session`,
   then grep `/tmp/psd.log` for the bordered detail window (`┌…┐`, `· command`/`· skill` rows) following the highlight. Add `sh -c 'stty cols 40; …'` around the command for a narrow terminal that triggers the scroll/ellipsis paths.
4. **Regression:** `npm test` (renderer/presentation seams) and `npm run typecheck` must stay green.

The replacement itself is deliberate — see ADR-0001 (why the popup internals are read) and ADR-0002 (why we own the editor slot).

## Glossary / decisions

See `CONTEXT.md` (Completion popup, Candidate, Detail window, Highlight) and `docs/adr/0001-tracking-editor-for-skill-descriptions.md` (accepted) before implementing.
