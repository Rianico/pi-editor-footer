# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
