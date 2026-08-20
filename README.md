<h1 align="center">pi-editor-footer</h1>

<p align="center">A pi TUI theme — project-aware footer, model border, and skill detail window.</p>

A [pi](https://pi.dev) extension that turns the editor chrome into a project-aware theme while preserving the skill-description detail window. It owns pi's single custom-editor slot via `TrackingEditor` and renders entirely against pi's live theme (no hardcoded colors).

## Features

**Detail window** — bordered window above the input that mirrors the completion popup's highlight and shows the candidate's full description (wrapped at `width − 4`, cap 5 lines, `…` ellipsis, `offset/total` header, shrinks when empty). Lifecycle mirrors the popup (opens/closes with it); hidden for candidates without a description. Scroll with **shift+up/down** (fallback **alt+j/k**).

**Model border** — top border shows `provider/model · thinking · contextWindow` with thinking-level glow via `getThinkingBorderColor`. Toggle with `/model-info` (off restores pi's stock border).

**Footer** — single line below the input, responsive via `fitSegmentsByPriority` and `alignRight`:
- Left: `cwd` (`·` `git branch` + status `[! ? + ↑↓]` + stashed/conflicted) `•` `runtime` (`node`/`python`/`rust`/`go`… + version) `•` `timer` (`working`/`done`)
- Right: `tokens` (` input |  output |  $cost`) immediately next to `context` (` [bar] % · tokens/contextWindow`)
- Separators: `·` between `cwd` and `git`, `•` as default between other left components; `tokens` sits directly left of the context bar
- `cwd` respects `workspaceDisplay` (`~/development/ai/pi-skill-desc` vs `pi-skill-desc`, switchable in settings)
- `context` bar uses `stressColor` and `renderBar` (12 cols max) with `•`/`·` handling
- Extension statuses line (`wrapTextWithAnsi`) when `footerSegments.extensionStatuses`

All segments are toggleable via `footerSegments` (`cwd`, `sessionName`, `gitBranch`, `gitStatus`, `gitCommit`, `runtime`, `context`, `tokens`, `cost`, `extensionStatuses`). Footer is installed via `ctx.ui.setFooter` when available, fallback to `setWidget("theme-footer", …, {placement:"belowEditor"})`, and is fully removed when the extension is disabled (`enabled: false` restores pi's default footer).

**Cursor** — `block` (software reverse, `setShowHardwareCursor(false)`), `bar` (`\x1b[6 q`), `underline` (`\x1b[4 q`) with hardware cursor (`setShowHardwareCursor(true)`). Style is previewed in real time: when the settings overlay is open (`!focused` + `previewHardwareCursor`), the software cursor ` \x1b[7m…\x1b[0m` is replaced with `CURSOR_MARKER` so the layout shows the hardware shape instantly; when focused the software cursor is removed and the hardware sequence is written.

**Input border** — bottom border is kept clean (no `cwd`); right side shows telemetry when `telemetry.enabled` (`TPS`, `TTFT`, `duration`, `tokens`, `stalls`, `cost` via `TurnTelemetryTracker`).

**Config** — single JSON `~/.pi/agent/pi-skill-desc.json` (validated at load, `DEFAULT_CONFIG` with `enabled:true`, `workspaceDisplay:"path"`, `cursorStyle:"block"`, `icons:"auto"`, all `footerSegments`/`telemetry` on). Settings dialog `/pi-footer` (General/Appearance/Footer/Telemetry, English, `Tab`/`↑↓`/`Enter`/`Esc`) live-edits and persists via `saveConfig`, with `cursorStyle` and `enabled` applying instantly and `workspaceDisplay` switching `cwd` format.

## Quick start

```bash
pi -e ./src/index.ts
```

Type `/` → popup opens, detail window appears above input, header shows model top, footer shows `cwd · git • runtime` left and `tokens  context` right. `/pi-footer` opens settings; `/model-info` toggles border glow.

## Why you need this

The native popup truncates long skill descriptions mid-sentence; the detail window shows the full text without guessing. The native footer shows only context; this footer adds the project context you actually need — which branch, how many files changed, which runtime, how many tokens — while keeping the context bar for the limit.

## Breakage mode

Highlight tracking observes two private `pi-tui` internals (`autocompleteList`, `applyAutocompleteSuggestions` per ADR-0001). At load it asserts both and warns `[pi-skill-desc] pi-tui internals changed…` if pi renames them; the window then never appears rather than showing wrong content. Single editor slot ownership is per ADR-0002.

## Manual verification

1. `pi -e ./src/index.ts` (or `pi -ne -e ./src/index.ts` to isolate)
2. `/` → tab through candidates, detail window follows; `shift+down` scrolls long text
3. Footer: `cwd` (`·` `git`) `•` `runtime` left, `tokens` right next to `[bar] %` right; `/pi-footer` → General → `Workspace display` toggles `~/…/pi-skill-desc` vs `pi-skill-desc`
4. Cursor: `/pi-footer` → General → `Cursor style` cycles `block`/`bar`/`underline`, shape updates in real time (bar shows `|`, underline `_`)
5. Disable: `/pi-footer` → General → `Enabled: Off` → footer reverts to pi's default (relative time / model); re-enable restores theme

## Project structure

```
pi-editor-footer/
├── src/
│   ├── index.ts               # extension entry, widget/header/footer install, /model-info
│   ├── tracking-editor.ts     # TrackingEditor (Editor slot, highlight, border, cursor)
│   ├── footer.ts              # renderFooter / installFooter (cwd·git • runtime • tokens·context)
│   ├── header.ts              # header disabled, cwd preserved in footer
│   ├── detail-render.ts       # wrap/scroll/ellipsis (tested)
│   ├── window-presentation.ts # bordered themed box (tested)
│   ├── model-info.ts          # top border glow+label
│   ├── git.ts                 # readGitStatus (branch/ahead/behind + staged/modified/...)
│   ├── runtime.ts             # readRuntimeInfo (node/python/rust/go/… via lockfiles)
│   ├── telemetry.ts           # TurnTelemetryTracker + formatTurnTelemetry
│   ├── config.ts              # ThemeConfig + load/save
│   ├── theme-settings.ts      # /pi-footer dialog
│   └── state.ts               # FooterState
├── test/
└── docs/
    ├── adr/0001-tracking-editor-for-skill-descriptions.md
    └── adr/0002-own-editor-slot-port-model-info-glow.md
```

## Development

- `npm test` — `node:test` + `tsx` (87 cases)
- `npm run typecheck` — strict TS

## License

No license declared yet; all rights reserved. (Private repository.)
