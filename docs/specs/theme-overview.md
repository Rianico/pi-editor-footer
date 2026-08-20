# Spec: pi-skill-desc → Full pi TUI Theme

**Status:** draft  
**Branch:** `dev/theme-refactor`  
**Reference:** `tmp/pi-open-tui` (mirror, rebuild bespoke — never vendored)  
**Map:** #5

## 1. Destination

Turn `pi-skill-desc` (detail window above input, TrackingEditor, model-info border glow) into a **full TUI theme** — rebuilt bespoke on `TrackingEditor`'s architecture. Reaching the end: a renamed theme whose

- header (cwd + slash hints, no model/thinking),
- responsive footer (git, 50+ runtime, context, tokens, cost, extension status),
- editor cursor styles (block/bar/underline),
- live telemetry right-aligned on the input's **bottom** border (all six toggleable)

all render against **pi's live theme**, while

- skill-description detail window (cap 5 lines, scrollable)
- model-info border glow on the **top** border
- single editor slot ownership

are preserved, and `workspaceDisplay: "path" | "name"` is honoured.

All visuals must respect pi's live `Theme` (read via `ctx.ui.theme` / `getFgAnsi`, `getThinkingBorderColor`, `fg`, etc.). No hardcoded colors.

## 2. Standing Decisions (R1/R2)

| Decision | Choice |
| --- | --- |
| Theme scope | **Full theme** (header+footer+project awareness) |
| Build method | **Rebuild bespoke**, `tmp/pi-open-tui` as reference only |
| Header model display | **Omit model/thinking** — border owns it |
| Footer richness | **Wholesale** — git + 50+ runtime + all segments |
| Border layout | **Model glow top, telemetry right bottom** |
| Settings surface | **Lightweight English dialog** (`/theme` or `/open-tui` equivalent) |
| Workspace toggle | `workspaceDisplay: "path" | "name"` config flag |
| Identity | **Rename** package + display name to read as theme |
| Execution | **Carry into map** — each ticket delivers working subsystem |

## 3. Non-Goals / Out of Scope

- Full bilingual (EN/ZH) settings — English only.
- Vendoring `pi-open-tui` code.
- Replacing pi's native header/footer vs augmenting (theme adds its own).

## 4. Architecture

### 4.1 Editor Slot

`TrackingEditor extends Editor` owns `setEditorComponent`. It replicates `CustomEditor` inline (handleInput, actionHandlers, duck-typing). All editor features fold into it:

- highlight observation (`autocompleteList` + `applyAutocompleteSuggestions` patch)
- model-info glow (`applyModelInfo` on top border)
- telemetry segment on bottom border (right-aligned)
- cursor styles (bar `\x1b[6 q`, underline `\x1b[4 q`, hardware cursor)

See `docs/reference/pi-tui-internals.md`, ADRs 0001/0002.

### 4.2 Widgets

- **Detail window** — `setWidget("pi-skill-desc", ..., {placement:"aboveEditor"})` — preserved.
- **Header** — `setWidget("theme-header", ..., {placement:"aboveEditor"})` or TUI header slot if available; always on.
- **Footer** — `setWidget("theme-footer", ..., {placement:"belowEditor"})`; responsive, priority-based shedding.

Header and detail window both use `aboveEditor` — they must not overlap. Header is always visible; detail window appears only with popup. Header sits above detail window (or detail window pushes header).

### 4.3 Config

Single JSON file `~/.pi/agent/pi-skill-desc.json` or `~/.pi/agent/theme.json` (decided in config ticket). Shape:

```ts
interface ThemeConfig {
  enabled: boolean
  workspaceDisplay: "path" | "name"
  cursorStyle: "block" | "bar" | "underline"
  icons: { mode: "auto" | "nerd" | "ascii" }
  telemetry: { enabled: boolean; tps: boolean; ttft: boolean; duration: boolean; tokens: boolean; stalls: boolean; cost: boolean }
  footerSegments: { cwd: boolean; sessionName: boolean; gitBranch: boolean; gitStatus: boolean; gitCommit: boolean; runtime: boolean; context: boolean; tokens: boolean; cost: boolean; extensionStatuses: boolean }
  // + fullscreen wheel etc. deferred to fog
}
```

Defaults match `tmp/pi-open-tui`'s DEFAULT_CONFIG where applicable. Live reload on settings dialog save, re-render requested.

### 4.4 Theme Respect

Every new surface reads live theme:

- `theme.fg("accent" | "dim" | "border" | "text" | ...)`
- `theme.getThinkingBorderColor(level)` for glow
- Icons via glyphs resolved by `icons.mode`

No hardcoded ANSI except cursor sequences (not themed).

## 5. Subsystems & Tickets

| # | Ticket | Spec File |
| --- | --- | --- |
| 6 | Theme identity & rename | `02-identity.md` |
| 7 | Config schema & persistence | `01-config.md` |
| 8 | Editor border: model-label + telemetry layout | `03-border.md` |
| 9 | Header: cwd + hints (no model) | `04-header.md` |
| 10 | Footer wireframe & segments | `05-footer.md` |
| 11 | Cursor styles in TrackingEditor | `02-editor-cursor.md` |
| 12 | Telemetry engine | `03-telemetry.md` |
| 13 | Git state engine | `06-git.md` |
| 14 | Runtime detection | `07-runtime.md` |

Each spec file defines acceptance criteria sized to one PR.

## 6. Verification

- `npm run typecheck` passes
- `npm test` passes (new pure modules unit-tested via `node:test` + `tsx`)
- Manual live pi session: theme loads via `pi -e ./src/index.ts`, header/footer render, detail window tracks, border shows model top + telemetry bottom right, cursor style toggles, workspaceDisplay toggles.
