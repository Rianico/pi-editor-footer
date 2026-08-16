# pi-skill-desc

A [pi](https://pi.dev) extension that augments the built-in slash-command completion popup (`/` + tab): a **detail window** appears above the input box showing the **full, untruncated description** of whatever candidate is currently highlighted. The native popup is untouched — the window appears with it, tracks the highlight, and disappears with it.

Capped at **5 lines**. Long descriptions scroll with **shift+up / shift+down**. The window shrinks to fit short ones, shows a `offset/total` scroll marker when overflowing, and stays hidden for candidates without a description.

## What it tracks

The window mirrors the native completion popup's highlight — skills (`skill:<name>`, description from SKILL.md frontmatter), slash commands, templates, and extension commands. Tools never appear because they are agent-invoked, not slash-invocable.

## Install

Load it with pi:

```bash
pi -e ./src/index.ts
```

or install it persistently by symlinking into the global extensions directory:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s /path/to/pi-skill-desc ~/.pi/agent/extensions/pi-skill-desc
```

(The extension only activates in TUI mode, at session start. After installing, restart pi or run `/reload`.)

## Usage

1. Type `/` in the input box to open the completion popup.
2. Cycle candidates with tab or the arrow keys.
3. The detail window above the input shows the highlighted candidate's full description.
4. When a description is longer than the window, **shift+up / shift+down** scrolls it one line per press (clamped at both ends). The keys are inert when the window is hidden.
5. The window closes with the popup (escape, selection, or typing).

## Terminal requirement for scrolling

shift+up/down must arrive as *modified-arrow* sequences (Kitty keyboard protocol) to be distinguishable from plain arrows. Terminals that alias shift+arrows to plain arrows simply get no scroll — everything else still works. In most modern terminals (Kitty, iTerm2, recent WezTerm/Windows Terminal) this just works.

## Breakage mode

The extension observes the popup's highlight through two **private pi-tui internals** (see `docs/adr/0001-tracking-editor-for-skill-descriptions.md`): the `autocompleteList` field and the `applyAutocompleteSuggestions` method. At load it asserts both exist and prints a warning:

```
[pi-skill-desc] pi-tui internals changed — highlight tracking may be broken ...
```

when they don't. Failures are loud, never silent: if pi renames these internals in an update, the extension warns at startup and the window simply never appears (or freezes on the first highlight) instead of showing wrong descriptions.

## Manual verification

1. Load the extension (`pi -e ./src/index.ts`).
2. Type `/` — the completion popup opens.
3. Press tab (or arrow down) a few times. The detail window above the input should show each highlighted candidate's full description as you cycle.
4. Find a long description (e.g. `/grilling` or `/writing-for-agents`) — press **shift+down** repeatedly: the text scrolls, and the header's scroll marker advances (`1/9` → `2/9` …). shift+up scrolls back.
5. Press escape (or select with enter/return): popup and detail window close together.
6. Type a description-less candidate (e.g. a plain path completion): the window stays hidden.

## Development

- `npm test` — the pure renderer suite (`node:test` + `tsx`)
- `npm run typecheck` — strict TypeScript check

Layout: `src/index.ts` (extension entry: editor install, window widget, scroll shortcuts, self-check), `src/tracking-editor.ts` (highlight observer), `src/detail-render.ts` (pure, tested renderer).
