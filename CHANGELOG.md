# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- Context bar moved from left bottom border to top border right of model info (`── model · thinking · 1.0M  # [#####-------] 39.6% · 416k/1.0M ── T1 · 8s` via `embedTopWithLeftAndRight`, `TrackingEditor.setTopContextText`)

## [0.2.0] - 2026-08-21

### Added

- Real-time telemetry via `TurnTelemetryTracker.peekLive()` and 1 s live tick — bottom border `> TPS 60.6 tok/s | ~ TTFT 2.5s | + 8.3s | ↑ 395 | ↓ 505 | $0.16` refreshes on every `agent/turn/message/tool` event during streaming
- Top-border run activity `T1 · 8s · 2 tools · 1 failed` via `RunActivityTracker` (turn · duration · tool calls · failed) adapted from `pi-atelier/src/run-activity.ts`
- Context bar moved to left bottom border `── # [#####-------] 39.6% · 416k/1.0M ──` (`formatContextBar` helper, `barWidth 10`, theme-aware, respects `footerSegments.context`, live-updates)
- Architecture deepening: split `utils.ts` into 5 focused modules (`path-format`, `color-policy`, `format`, `layout`, `tip-policy`), deepened `ConfigStore`, `Footer`, `TrackingEditor` (`BorderRenderer`/`CursorPolicy`), `SessionKernel` (candidates 1–5)

### Changed

- Footer no longer renders context (moved to border); right block is now just stats (`↑`/`↓`/`$`)
- Context window `formatContextWindow` now `1.0M` (was `1m` lowercase no decimal) to match `fmtTokens` (`362k/1.0M`)

### Fixed

- Streaming `TPS — | ↓ 0` until `turn_end` — now estimates live tokens (`~4 chars/token`) and shows live `TPS`/`↓` during `message_update`
- Cost duplicate `$ $0.16/M` → `$0.16` (single `$` when glyph is `$`, nerd keeps ` $0.16`) and hid `per M` suffix as common sense
- Cost duplicate in footer `$ $0.000` → `$0.000`
- `formatContextWindow` `1m` → `1.0M` (capital `M`, one decimal) for `0.9k/1.0M` consistency

## [0.1.2] - 2026-08-20

### Fixed

- `npm:pi-editor-footer` not being discovered when installed via `pi install npm:pi-editor-footer` — added `pi.extensions` (`dist/index.js`) and `keywords` so pi loads the theme from `~/.pi/agent/npm/node_modules`

## [0.1.1] - 2026-08-20

### Fixed

- `npm:pi-editor-footer` now works when installed via `pi install npm:pi-editor-footer` — added `main` (`dist/index.js`), `files`, and `build` (`tsc --project tsconfig.build.json`) so pi can discover the extension from `~/.pi/agent/npm/node_modules`

## [0.1.0] - 2026-08-20

### Added

- Full TUI theme `pi-editor-footer` rebuilt on `TrackingEditor`: project-aware footer (`cwd` · `git` • `runtime` left, `tokens` next to `context` right), model-info border glow top, live theme respect, detail window preserved
- Cursor styles `block`/`bar`/`underline` with real-time preview and hardware cursor handling
- Settings dialog `/pi-footer` (General/Appearance/Footer/Telemetry, `workspaceDisplay` path/name toggle, `enabled` restores default footer)
- Git state engine (branch/ahead/behind + staged/modified/untracked/conflicted/stashed) and 10+ runtime detection via lockfiles
- Telemetry bottom border (right-aligned, toggleable `tps`/`ttft`/`duration`/`tokens`/`stalls`/`cost`)
- Bottom border clean (no `cwd`), footer single line with `•`/`·` separators

### Changed

- Renamed package `pi-skill-desc` → `pi-editor-footer` and `/pi-lsz-theme` → `/pi-footer` (removed `/theme` alias)
- Footer now single line `cwd·git•runtime` left / `tokens·context` right; bottom border no longer shows `cwd`

### Fixed

- Cursor white background when switching styles and invisible cursor after switch — hardware cursor handling with `CURSOR_MARKER` preview
- Footer `*` git icon removed, footer empty at startup until `readGitStatus` now populated, and disabled extension correctly restores default footer
