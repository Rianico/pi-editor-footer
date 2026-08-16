# Track the native completion popup's highlight via a custom editor

Pi's extension API exposes no event for which row is selected in the built-in slash-command completion popup, yet the goal is a detail window that mirrors that highlight as the user cycles. We install a custom editor — `TrackingEditor`, a subclass of pi-tui's exported `Editor` replicating the app's `CustomEditor` — that keeps the native popup untouched and observes its selection through `SelectList.onSelectionChange` (a public callback the editor leaves unwired), plus one instance-level patch on the private `applyAutocompleteSuggestions` to re-hook the list when suggestions refresh. The detail window renders via `setWidget(..., { placement: "aboveEditor" })`; `shift+up` / `shift+down` (unbound keys) scroll long descriptions.

Status: accepted

## Considered Options

- **Own picker overlay** (`ctx.ui.custom` with a candidate list + detail pane): rejected — the user explicitly does not want a finder/picker; the native `/`+tab flow must be augmented, not replaced.
- **Data-only autocomplete provider wrapper**: rejected — `addAutocompleteProvider` supplies items but no selection-change signal, so a detail window could not follow the highlight.
- **Reading the selection via runtime casts into private fields**: chosen — the only path that preserves the native flow; the blast radius is two internals (`autocompleteList` field, `applyAutocompleteSuggestions` method), and failures are loud (the patch stops firing), never silently wrong.

## Consequences

- The extension reaches into two private pi-tui internals; a rename upstream breaks it loudly and needs a one-line fix.
- Terminal support for modified-arrow sequences (Kitty protocol) is required for shift+up/down to be distinct from plain arrows; legacy terminals will alias them.
- Tools are not covered — the `/` completion popup lists slash commands, templates, extension commands, and skills only.
- Description data needs no catalog lookups: the popup's `SelectItem` carries the full (non-truncated) description.
