<h1 align="center">pi-skill-desc</h1>

<p align="center">A detail window that mirrors the completion popup's highlight — showing each candidate's <b>full, untruncated description</b>.</p>

A [pi](https://pi.dev) extension for the built-in slash-command completion popup (`/` + tab). When the popup opens, a bordered window appears **above the input box** and shows the complete description of whatever candidate is currently highlighted. The native popup is untouched — the window appears with it, tracks the highlight through tab/arrows, and disappears with it.

> **Scope & honesty.** The window is a companion to the native popup, never a replacement: no separate picker, no filter/finder, no reimplementation of completion. It exists to show text the popup itself truncates.

## Why you need this

The native popup shows each candidate as a **single truncated line** — a long description (e.g. `/grilling`, `/writing-for-agents`) is cut off mid-sentence before you can tell whether that's the command you want. There is no way to see the rest without guessing or opening the SKILL.md.

The window fixes exactly that: it reads the popup's live highlight and renders the candidate's full description above the input, scrolled and wrapped to fit. Long descriptions scroll; short ones shrink the window; candidates without a description show nothing.

Honest limits: tracking relies on two **private pi-tui internals** (ADR-0001) — a pi update that renames them triggers a loud startup warning and the window stops appearing, it never shows wrong content. The extension also owns pi's single custom-editor slot, which is why the model-info glow was ported in (ADR-0002).

## Quick start

```bash
pi -e ./src/index.ts        # load the extension
```

Type `/`, press **tab** a few times. What you see:

```
 ~/development/ai/pi-skill-desc (main)
┌──────────────────────────────────────────────┐
│ to-spec · skill  1/6                          │  ← header: accent+bold, scroll marker
│ Turn the current conversation into a spec,    │  ← description: dim, wrapped at width−4
│ …                                             │  ← more content below
└──────────────────────────────────────────────┘
 /grilling █
```

Tab cycles the highlight; the window follows. **shift+down** scrolls long descriptions (universal fallback: **alt+k**). Escape or Enter closes popup and window together.

## The window

- **Cap:** 5 content lines. Two border rows are chrome *outside* the cap — the window is at most 7 rows tall and shrinks to fit short descriptions.
- **Themed:** header is the theme's highlight (accent + bold), body is the theme's dim, borders use the theme's border color. The theme is read live, so a theme swap applies on the next render.
- **Wrapping:** content wraps at `width − 4` (the two border columns on each side).
- **Overflow marker:** when a description overflows, the header gains an `offset/total` marker (`1/6` → `2/6` …) so you always know where you are.
- **Ellipsis:** while more content remains below, the last visible line is `…` (bottom-only — the top of the window always shows real content).
- **Lifecycle:** mirrors the popup exactly — opens with it, closes with it (escape, selection, or typing). No idle timer.
- **Hidden:** candidates without a description render nothing.

## Scrolling

| Terminal | shift+up / shift+down | alt+j / alt+k |
| --- | --- | --- |
| Kitty, iTerm2, recent WezTerm/Windows Terminal | ✅ | ✅ |
| Other terminals (shift+arrows aliased to plain arrows) | ❌ | ✅ |

- ✅ works out of the box · ❌ sequence not distinguishable (no Kitty keyboard protocol)
- shift+up/down must arrive as *modified-arrow* sequences to be told apart from plain arrows. Terminals that alias shift+arrows simply get no scroll — everything else still works.
- **alt+j / alt+k** are the universal fallback: same one-line-per-press behavior, no protocol needed.
- All scroll keys are inert while the window is hidden.

## What it tracks

Skills (`skill:<name>`, description from SKILL.md frontmatter), slash commands, templates, and extension commands. Tools never appear — they are agent-invoked, not slash-invocable. Pi's own source tags (`[t]` for this-session `-e` extensions, `[u]` for user-installed ones) appear in descriptions exactly as the popup renders them.

## `/model-info`

`/model-info` toggles the **border glow + model label** on the input box (off restores pi's stock border). The glow rendering is a port of the `model-info-widget` extension, which is now redundant: pi allows only one custom editor, this extension owns the slot, so the widget's editor never activates and its behavior was moved in here (ADR-0002). You can delete `~/.pi/agent/extensions/model-info-widget` and lose nothing.

Note: the native footer shows the model + thinking level on its right side regardless — the border label is a duplicate of that. Toggle it off if you'd rather not see the model twice.

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
4. Find a long description (e.g. `/grilling` or `/writing-for-agents`) — press **shift+down** repeatedly: the text scrolls, and the header's scroll marker advances (`1/9` → `2/9` …). shift+up scrolls back. If shift+arrows don't scroll in your terminal, try **alt+k** / **alt+j**.
5. Press escape (or select with enter/return): popup and detail window close together.
6. Type a description-less candidate (e.g. a plain path completion): the window stays hidden.
7. Run **`/model-info`** — the input border loses its glow/label; run it again to restore.

## Project structure

```
pi-skill-desc/
├── src/
│   ├── index.ts               # extension entry: editor install, window widget, scroll keys, /model-info, self-check
│   ├── tracking-editor.ts     # CustomEditor subclass that observes the popup highlight (ADR-0001)
│   ├── detail-render.ts       # pure renderer: wrap, scroll, header marker, bottom ellipsis (tested)
│   ├── window-presentation.ts # pure: bordered, themed box — header accent+bold, body dim (tested)
│   └── model-info.ts          # border glow + model label (port of model-info-widget, ADR-0002)
├── test/
│   ├── detail-render.test.ts        # 17 cases
│   └── window-presentation.test.ts  # 6 cases
└── docs/
    ├── adr/
    │   ├── 0001-tracking-editor-for-skill-descriptions.md   # private-internals tracking, blast radius
    │   └── 0002-own-editor-slot-port-model-info-glow.md     # editor-slot ownership, glow port
    ├── agents/                 # issue-tracker, triage-labels, domain glossary
    └── reference/pi-tui-internals.md
```

## Development

- `npm test` — the pure renderer suite (`node:test` + `tsx`, 23 cases)
- `npm run typecheck` — strict TypeScript check

Editor wiring (highlight observation, widget install, scroll keys) is verified manually in a live session rather than unit-tested; the two pure modules above carry the automated coverage.

## Docs

- ADR-0001 — why tracking goes through private pi-tui internals, and the blast radius if they change
- ADR-0002 — why the extension owns pi's single editor slot, and how the model-info glow was ported
- `docs/reference/pi-tui-internals.md` — the observed internals this extension depends on

## License

No license is declared yet; until one is added, all rights reserved. (Repository is currently private.)
