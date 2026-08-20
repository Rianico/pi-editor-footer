# Spec 04 — Header: cwd + Hints (No Model)

Ticket: #9 · Type: grilling · Branch: `feat/header`

## Question

What does the header contain and where does it sit, given the border already owns model/thinking and the detail window already lives above the editor?

## Decision

- Content: `cwd` (honouring `workspaceDisplay: "path" | "name"`) + slash-command hints. **No model/thinking** — border owns it.
- `cwd`: `formatCwd(cwd)` when `workspaceDisplay==="path"`, `basenamePath(formatCwd(cwd))` when `"name"`. Truncated via `truncatePath` at narrow widths.
- Hints: 2–3 slash-command tips (e.g. `/theme`, `/model-info`) via `pickSlashCommandTips` or static list; dimmed.
- Placement: `setWidget("theme-header", ..., {placement:"aboveEditor"})`, always on when `config.enabled`. Must not overlap detail window: header renders first, detail window renders above editor but below header (or header is topmost). Use TUI widget ordering.
- Theme: reads live `Theme`, glyphs via `icons.mode` (`resolveGlyphs`), respects `theme.fg("dim")` for hints.

## Reference

- `tmp/pi-open-tui/extensions/open-tui/header.ts` (~200 lines, logo + cwd + hints)
- `tmp/pi-open-tui/extensions/open-tui/utils.ts` (`formatCwd`, `basenamePath`, `truncatePath`, `pickSlashCommandTips`)
- `tmp/pi-open-tui/extensions/open-tui/icons.ts`

Rebuild bespoke, simplify: no animated logo (defer to fog), just cwd + hints line(s).

## Acceptance

- [ ] `src/header.ts` exports `installHeader` / `renderHeader` with cwd + hints, workspaceDisplay-aware
- [ ] Respects live theme + icon mode
- [ ] No overlap with detail window when popup open
- [ ] `npm run typecheck` + `npm test` pass (pure render unit test)
