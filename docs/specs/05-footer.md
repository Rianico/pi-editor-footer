# Spec 05 — Footer Wireframe & Segments

Ticket: #10 · Type: grilling · Branch: `feat/footer`

## Question

What is the footer's wireframe: which segments, how they respond to width, and where cost lives?

## Decision

- Segments (priority low→high, high survives): `cwd` (if not in header), `gitBranch`, `gitStatus`, `runtime`, `context`, `tokens`, `cost`, `extensionStatuses`. `sessionName` optional.
- Each segment: `{text, compactText?, truncate?, priority}` consumed by `fitSegmentsByPriority`.
- Placement: `setWidget("theme-footer", ..., {placement:"belowEditor"})`, always on.
- Responsive: `fitSegmentsByPriority(maxWidth)` — compact forms first, then drop lowest priority.
- Cost duplication: cost shown in **bottom-border telemetry** (rate) and optionally footer (total) — footer shows `fmtTokens` + extension status; border shows telemetry cost rate. Footer may omit cost if telemetry enabled (decide in impl).
- Refresh: git + runtime polled on `session_start` and interval; footer re-renders on `requestRender`.
- Theme: live `Theme`, glyphs via `icons.mode`.

## Reference

- `tmp/pi-open-tui/extensions/open-tui/footer.ts` (300+ lines)
- `tmp/pi-open-tui/extensions/open-tui/utils.ts` (`fitSegmentsByPriority`, `truncatePath`, `fmtTokens`, `formatDuration`)
- `tmp/pi-open-tui/extensions/open-tui/state.ts`

## Acceptance

- [ ] `src/footer.ts` with segment priorities and `fitSegmentsByPriority` integration
- [ ] Reads `config.footerSegments`, respects theme + icon mode
- [ ] Narrow width sheds gracefully (snapshot test)
- [ ] `npm run typecheck` + `npm test` pass
