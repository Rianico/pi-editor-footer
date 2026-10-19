# pi-tui internals reference (verified against installed packages)

Implementation reference for the Detail-window extension. All facts below were verified by reading the **installed** packages on 2026-10-19:

- `@earendil-works/pi-coding-agent` **1.3.0** — dist types + `interactive-mode.js` / `components/custom-editor.js`
- `@earendil-works/pi-tui` **1.3.0** — dist source

Pin dev dependency `@earendil-works/pi-tui@1.3.0` for types; that is the same version the pi runtime ships (`@earendil-works+pi-tui@1.3.0` under the pnpm global install of pi 1.3.0), so the types and the runtime the extension runs against agree. The extension imports at runtime only from `@earendil-works/pi-tui` (pi provides it).

**Bumping the dev dependency:** 1.3.0 adds runtime deps (`marked`, `get-east-asian-width`). If the lockfile still holds the old tree, `rm -rf node_modules && pnpm install` — a plain `pnpm install` can keep a stale peer resolution. pi-tui ships **no `exports` map**, so deep paths still resolve, but prefer the exported seams listed below.

## Extension model

- Extensions are TypeScript modules with a **default-exported factory**: `export default function (pi: ExtensionAPI): void | Promise<void>`.
- Auto-discovered from `~/.pi/agent/extensions/` or `.pi/extensions/` (project), or `pi -e ./path.ts`.
- `ExtensionAPI` members used here (verified `dist/core/extensions/types.d.ts:1231-1293`): `registerShortcut(KeyId, {description?, handler(ctx)})`, `registerCommand(name, options)`, `on(event, handler)`, `getAllTools()`, `getCommands()`, `registerEntryRenderer(customType, renderer)`, `appendEntry(customType, data?)`.
- Event handlers receive `ctx: ExtensionContext` with `ctx.ui: ExtensionUIContext` and `ctx.mode` (`"tui"` guards terminal-only UI).
- One 1.3.0 host behaviour to know when smoke-testing: an untrusted project prints `This project is not trusted. Project .pi resources and packages are ignored.` — an explicitly passed `-e ./src/index.ts` still loads.

## ExtensionUIContext members (verified in dist/core/extensions/types.d.ts)

- `setWidget(key, content, options?)` where `content` is `string[]` or a component factory `(tui, theme) => Component & {dispose?()}`; `options.placement: "aboveEditor" | "belowEditor"` (default aboveEditor). **Still only those two placements in 1.3.0** — `setWidget` cannot interleave a line into the transcript; use `appendEntry` for that (see Timeline injection).
- `setStatus(key, text | undefined)` — status/footer text.
- `custom<T>(factory, {overlay?, overlayOptions?, onHandle?})` — focus-taking overlay (not used by this extension).
- `onTerminalInput(handler): unsubscribe` — raw keystrokes before the focused component; `{consume}` / `{data}`.
- `setEditorComponent(factory | undefined)` where `factory = (tui, theme, keybindings) => EditorComponent`; `getEditorComponent()` returns the current factory.
- `addAutocompleteProvider(factory)` — stacks on the built-in provider (data only; no selection signal).
- `setFooter(...)` — footer rows.

## The editor contract (pi-tui EditorComponent)

`EditorComponent` in `dist/editor-component.d.ts` is **byte-identical to 0.84.2**: `getText()/setText()/handleInput(data)/onSubmit?/onChange?/addToHistory?/insertTextAtCursor?/getExpandedText?/setAutocompleteProvider?/borderColor?/setPaddingX?/setAutocompleteMaxVisible?`.

`Editor` class is **exported** from `@earendil-works/pi-tui`: `constructor(tui, theme, options?: EditorOptions)`; `EditorOptions = { paddingX?, autocompleteMaxVisible? }` (unchanged in 1.3.0). Public members used: `getText()`, `setText()`, `isShowingAutocomplete()`, `onSubmit`, `onChange`, `setAutocompleteProvider`, `handleInput`, `focused`, `borderColor`.

### Editor surface delta 0.84.2 → 1.3.0 (what a maintainer must port)

| Change | Impact here |
| --- | --- |
| **`renderTopBorder(width, hiddenLineCount)` / `renderBottomBorder(width, hiddenLineCount)` are now `protected` methods** (previously inline in `render()`). | First real subclass seam for border ownership. `BorderRenderer` still rewrites `lines[0]` / the last border line after `super.render()`; overriding these two hooks is the clean migration. |
| `handleMouse(event: TuiMouseEvent)` on `Editor` (and on `SelectList`). | **Not overridden by `TrackingEditor`** — mouse clicks in the editor body / autocomplete popup are inert. Known un-ported delta (additive feature, not a regression from the bump). |
| `render()` wraps the character under the cursor in `renderFakeCursor(...)` (`FAKE_CURSOR_START`/`END` = `\x1b_pi:fc\x07`), and still emits `CURSOR_MARKER` (`\x1b_pi:c\x07`) when `focused` for hardware-cursor/IME placement. TUI strips the marker; fake cursors of unfocused components stay visible. | Inherited — our `render()` delegates to `super.render()` and only rewrites border lines, so the markers are preserved. Verified live. |
| `createScrollBorder()` label shape: 0.84.2 emitted `─── ↑ 3 more ───…` (left-anchored); 1.3.0 **centres** it (`────── ↑ 3 more ───`) and falls back to left-anchored only when narrow. | **Breaking for naive detection.** The old `^─── [↑↓] \d+ more` check silently overwrote pi's top scroll hint and missed the bottom one, dropping telemetry. Fixed by the tolerant `isEditorScrollBorderLine` in `src/layout.ts` (used by `src/border-renderer.ts`); pinned by `test/editor-border-compat.test.ts`. |
| Autocomplete trigger parsing tolerates quoted paths and prose-wrapped triggers (`autocompleteBoundaryRegex` / `autocompleteSeparatorRegex`); `getBaseDirSuggestions` added. | Popup opens in more cases; `AutocompleteSuggestions = {items, prefix}` unchanged, so tracking is unaffected. |
| `wordWrapLine()` exported; `TextChunk` type; `renderedVisibleLineCount` / `renderedAutocompleteHeight` cached for mouse hit-testing. | Unused; no impact. |
| New modules exported: `colors`, `mouse-region`, `oklab`, `program-status`, `wheel-scroll`, `native-platform`, `native-module-path`; `TerminalColors` replaces `RgbColor` in `terminal-colors`. | `colors` is a usable public seam (see Seams); the rest is unused. |

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

**Verified for 1.3.0:** this file is byte-identical between host 0.85.1 and 1.3.0 (`sha256 000b0056f2bf645537537468bdd6f6ee0c82e4110f5417c1c70c2e8fefc04f29`), so the inline replica in `src/tracking-editor.ts` needed no port for this bump. Re-check it on every pi release — it is copied source, not an imported one.

## setEditorComponent wiring (dist/modes/interactive/interactive-mode.js `setCustomEditorComponent`)

The factory is called `factory(this.ui, getEditorTheme(), this.keybindings)`. After creation, interactive mode **duck-types**: if the new editor has an `actionHandlers` property that is a `Map`, it copies all app-level handlers onto it — `onEscape`, `onCtrlD`, `onPasteImage`, `onExtensionShortcut` (falling back to the default editor's), and every entry of the default editor's `actionHandlers` map. It also wires `onSubmit`, `onChange`, copies text and appearance, and calls `setAutocompleteProvider` when supported.

→ A custom editor with `actionHandlers = new Map()` + `onAction(action, handler)` + the fields above behaves identically to the default editor.

**Verified for 1.3.0:** the wiring block and its comments are unchanged from 0.85.1 (same `actionHandlers` duck-typing, same `onEscape`/`onCtrlD`/`onPasteImage`/`onExtensionShortcut` copy). Teardown still calls `setCustomEditorComponent(undefined)`.

## The autocomplete popup internals (pi-tui components/editor.js + components/select-list.js)

- The popup is a `SelectList` stored in the private field **`autocompleteList`** (`private autocompleteList` — still declared in 1.3.0's `components/editor.d.ts`).
- The list is (re)created in the private method **`applyAutocompleteSuggestions(suggestions, state)`** — the only construction site, **body unchanged from 0.84.2**:

  ```ts
  applyAutocompleteSuggestions(suggestions, state) {
      this.autocompletePrefix = suggestions.prefix;
      this.autocompleteList = this.createAutocompleteList(suggestions.prefix, suggestions.items);
      const bestMatchIndex = this.getBestAutocompleteMatchIndex(suggestions.items, suggestions.prefix);
      if (bestMatchIndex >= 0) this.autocompleteList.setSelectedIndex(bestMatchIndex);
      this.autocompleteState = state;
  }
  ```

- `clearAutocompleteUi()` still sets `autocompleteList = undefined`, `autocompleteState = null`.
- Editor `handleInput` delegates to `this.autocompleteList.handleInput(data)` while the popup is open (up/down/tab/enter).
- `SelectList` is still exported; unchanged public members: `onSelectionChange?: (item: SelectItem) => void` (**left unwired by the editor — ours to use**), `getSelectedItem(): SelectItem | null`, `setSelectedIndex(index)`, `handleInput(keyData)`, `render(width)`, `setFilter(filter)`, `onSelect`, `onCancel`. 1.3.0 adds `handleMouse(event)` and private `mousePressedIndex` / `getVisibleRange`; constructor is still `(items, maxVisible, theme, layout?)`.
- `SelectList.handleInput` fires `notifySelectionChange()` on up/down (wraps around), which calls `onSelectionChange(selectedItem)`. Programmatic `setSelectedIndex` (initial best-match) does **not** fire it — read `getSelectedItem()` after wiring.
- `SelectItem = { value, label, description? }` — unchanged; the description is the **full, untruncated** text (truncation is display-only). Slash-command items carry `description`; file-completion items may not.

**Tracking recipe**: subclass `Editor`; in the constructor, instance-patch `applyAutocompleteSuggestions` (cast to `any` — TS-private) so that after each `super.applyAutocompleteSuggestions(...)` call you wire `list.onSelectionChange` on the fresh list and emit the current `getSelectedItem()`; in an overridden `handleInput`, call `super.handleInput(data)` then read `(this as any).autocompleteList` — wire if new, and emit `getSelectedItem()` (or `null` when the popup is closed, i.e. the field is undefined). Emit through a public `onHighlight?: (item: SelectItem | null) => void` property.

**Blast radius (ADR-0001)**: exactly two internal names — `autocompleteList` (field) and `applyAutocompleteSuggestions` (method). `assertInternals()` in `src/session-orchestrator.ts` verifies both at extension load and warns loudly if not; `test/pi-tui-internals-doc.test.ts` fails the suite if either disappears from the installed pi-tui or drops out of this doc.

## Timeline injection

The agent-run timeline is a transcript entry, not a widget: `pi.appendEntry("timeline", {text})` + `pi.registerEntryRenderer("timeline", (entry, _, theme) => new Text(theme.fg("dim", …)))` (`types.d.ts:1254,1272`). `custom` entries render in `chatContainer` order — interleaved between user/assistant messages, scrolling with history — and are **not** part of the model context. This is the preferred seam and what `src/transcript-timeline.ts` uses.

The older fallback (a `globalThis` scan for `InteractiveMode`, patching `addMessageToChat` / `rebuildChatFromMessages` and pushing into `chatContainer`) is deprecated and only reached when `appendEntry` is unavailable. Still verified present in 1.3.0 — `chatContainer` (`interactive-mode.js:241,387`), `addMessageToChat` (8 references), `rebuildChatFromMessages` (3 references) — but with `appendEntry` available nothing patches `InteractiveMode`, so this is no longer a private seam we depend on.

## Keybindings

- `pi.registerShortcut(shortcut: KeyId, {description?, handler(ctx)})`; `KeyId` strings like `"shift+up"`, `"shift+down"`.
- `shift+up` / `shift+down` are **unbound** in pi's defaults and not in the reserved list → free to register. (`ctrl+shift+up/down` = alt-screen prompt nav, `alt+up` = dequeue — avoid.)
- Conflict policy: reserved keys are silently skipped with a warning; non-reserved bound keys are overridden with a warning; unbound keys are clean.
- `matchesKey(data, "shift+up")` handles Kitty modified-arrow sequences (`\x1b[1;2A`). Terminals without modified-arrow reporting alias shift+arrows to plain arrows — scroll degrades to no-op.

## Data

- The completion popup lists slash commands, templates, extension commands, and skills (`skill:<name>`, description = SKILL.md frontmatter, prefixed with source info). **Tools never appear** — they are agent-invoked, not slash-invocable.
- No catalog lookups needed: the highlighted `SelectItem` carries its own full description.

## Seams: adopted vs still private (1.3.0)

Adopt these where they exist — the private surface is capped at two names and must not grow:

- **Scroll-border detection** — `src/layout.ts:isEditorScrollBorderLine` / `isEditorBorderLine` accept both the 0.84.2 left-anchored and 1.3.0 centred shapes; `src/border-renderer.ts` imports them (no local regex copies). *Adopted.*
- **Border ownership** — `protected renderTopBorder` / `renderBottomBorder` (new in 1.3.0) replace splicing `lines[0]` and scanning for the last border line. *Not adopted yet; open migration.*
- **Colour math** — the `colors` module (new in 1.3.0) exports `parseColor`, `foregroundAnsi(color, "truecolor" | "256color")`, `backgroundAnsi`, `colorToRgb`, `colorToHex`, `mixColors`, `styleText`. That is a public replacement for the local hex→ANSI quantizer in `src/ansi-color.ts`. *Not adopted yet; `hexFg` output is pinned by context-tier tests, so adoption must stay byte-identical.*
- **Transcript insertion** — `appendEntry` + `registerEntryRenderer`. *Adopted (see Timeline injection).*
- **Cursor** — `CURSOR_MARKER`, `FAKE_CURSOR_START/END`, `renderFakeCursor`, the public `focused` flag; hardware cursor style via `UI.setCursorStyle`. *Already public — no private access.*
- **Autocomplete highlight** — no public seam exists: pi exports `SelectList` with `onSelectionChange` but leaves it unwired, and `Editor` exposes no highlight callback. This is why `autocompleteList` + `applyAutocompleteSuggestions` remain the load-bearing private pair (ADR-0001).

## Sync contract — keeping the editor current with pi updates

This extension **replaces pi's default input editor** via `setEditorComponent`. `TrackingEditor` (`src/tracking-editor.ts`) is the actual editor in the input box: it replicates pi's `CustomEditor` inline and reads two private pi-tui internals — so **pi editor changes are NOT inherited automatically.** On every pi update, and whenever pi adds or changes editor behaviour, sync manually:

1. **Diff the replicated base.** Compare pi's `CustomEditor` (`dist/modes/interactive/components/custom-editor.js` in `@earendil-works/pi-coding-agent` — source in "How pi's CustomEditor works" above) and pi-tui's `Editor` (`components/editor.js` + `components/editor.d.ts` in `@earendil-works/pi-tui`) against `src/tracking-editor.ts`: port any new/changed app-keybinding branches, fields, or methods in `handleInput` (and now `handleMouse` if mouse support is wanted); keep the highlight-sync additions after each `super.handleInput(data)`. Port border behaviour into `renderTopBorder`/`renderBottomBorder` rather than adding more line-splicing in `src/border-renderer.ts`.
2. **Check the private internals.** Confirm `autocompleteList` and `applyAutocompleteSuggestions` still exist with the same names on pi-tui's `Editor`. `assertInternals()` in `src/session-orchestrator.ts` warns at load if the pair vanishes, and `test/pi-tui-internals-doc.test.ts` fails the suite if they vanish from the installed package **or** from this document. Fix the tracking, don't silence the warning. If pi ever exposes a highlight seam, delete the instance patching instead of widening it.
3. **Re-diff the border and cursor surface.** `createScrollBorder` shape, `renderFakeCursor` / `CURSOR_MARKER`, and `renderTopBorder`/`renderBottomBorder` are the three places a pi release has actually broken our chrome. `test/editor-border-compat.test.ts` pins both scroll-border shapes; extend it when the shape changes again. The cursor rewrite itself is `removeSoftwareCursor` in `src/cursor-policy.ts`: it reads **both** renderer shapes — 1.3.0's fake-cursor pair and the pre-1.3 reverse-video pair — so neither is a hard dependency, and `test/cursor-policy.test.ts` drives the real `Editor` to catch the next shape change.
4. **Verify live** with the scripted pty loop (the only seam for the editor wiring): from the repo root,
   `(sleep 14; printf '/'; sleep 1.5; printf '\033[B'; sleep 2; printf '\033'; sleep 2) | timeout 45 script -q /tmp/psd.log pi -e ./src/index.ts --no-session`,
   then check the log: top border carries `provider/model · thinking | c <hit%> | <pct> · <tokens>/<window>`, the footer carries `↑ n · ↓ n · $n`, and no `pi-tui internals` warning appears. Add `sh -c 'stty cols 40; …'` for the narrow/ellipsis paths. An untrusted project prints a trust notice; `-e` still loads the extension.
5. **Regression:** `pnpm build`, `pnpm test` (full suite, including the two guards above) and `pnpm typecheck` must stay green.

The replacement itself is deliberate — see ADR-0001 (why the popup internals are read) and ADR-0002 (why we own the editor slot).

## Glossary / decisions

See `CONTEXT.md` (Completion popup, Candidate, Detail window, Highlight) and `docs/adr/0001-tracking-editor-for-skill-descriptions.md` (accepted) before implementing.
