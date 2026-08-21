# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- Git branch never folded — `renderGitSegment` no longer `truncateBranch(…,20)`, full `feature/very-long-…` shown; priority `6` (> cwd `5`) so `fitSegmentsByPriority` never omits branch before cwd/runtime/stats
- Telemetry TPS display throttled to 1 s (data vs display separated) — `message_update` now only updates `liveDeltaChars`/`liveEstimatedTokens` in `TurnTelemetryTracker`, display `peekLive()` → `formatTurnTelemetry` only via `liveTickTimer` every `REFRESH_MS` and `message_start`/`end`/`turn_end`/`agent_settled` for approximately accurate TPS without per-delta TUI jank
- Telemetry cost toggling `telemetry.cost` off/on no longer resets cost to `$0.00` — `refreshLiveTelemetry` now falls back to `getLastTelemetry()` when `peekLive()` is null (idle) and `onConfigChanged` calls `refreshLiveTelemetry()` immediately
- Refresh rate set to one second (`REFRESH_MS = 1000` for `liveTickTimer` telemetry/top/context and `watchTimer` editor ownership watchdog, was hardcoded `1000`)
- Context icon bar now switchable via config `contextIconBar` (default `false` disabled) — `0.0% · 0/1.0M | c 0.0%` by default, `# [████░░] 39.6% · 416k/1.0M | c 85.3%` when enabled (footer top, `nerd`/`ascii` glyphs)
- Context bar format now `0.0% · 0/1.0M | c 0.0%` (was `# [#####-------] 39.6% · 416k/1.0M | c`; no icon/bar, compact `pct · tokens/W`)
- Context bar and cache now follow icon mode (`nerd` ``/``/`█` vs `ascii` ` #`/`c`/`#`) — `refreshContextBar` called in `onConfigChanged` so top ` # [...] | c` updates immediately when `icons.mode` changes
- Telemetry `>`, `~`, `+` glyphs removed (`TPS 60.6 tok/s · TTFT 2.5s · 8.3s · ↑395 · ↓505 · $0.16` not `> TPS … · ~ TTFT … · +8.3s`)
- Telemetry bottom border compacted (`TPS 60.6 tok/s · TTFT 2.5s · 8.3s · ↑395 · ↓505 · $0.16` not `> TPS 60.6 tok/s | ~ TTFT 2.5s | + 8.3s | ↑ 395 | ↓ 505 | $0.16`; `TPS`/`TTFT` labels preserved, no space after `↑`/`↓`, joiner `·` not ` | `, stall `!2·3.3s` not `! stall 2x / 3.3s`)
- Footer cache omitted to the right of input/output (`↑ 395 | ↓ 505 | $0.16` not `| c 85.3%`; cache remains only in top context bar ` # [...] | c 0.0%`)
- Nerd mode cost now `$0.00` not ` $0.00` (always single `$` in both footer `renderFooter` and telemetry `formatTurnTelemetry`, was `glyph === "$" ? `$ / ` : `glyph $` -> ` $`)
- Cache session now always shown with zero value (`c 0.0%` in footer `↑ | ↓ | $ | c` and ` | c 0.0%` in top context bar) instead of hidden when no cache tokens
- Footer cost now `toFixed(2)` (`$0.16` not `$0.160`) and moved directly after input/output (`↑ 395 | ↓ 505 | $0.16 | c 85.3%` not `c | $`; `theme.fg("dim","|")` pipe)
- Top border model label no longer shows context window (`provider/model · thinking` not `· 1.0M`; `buildLabel` ignores `contextWindow`)
- Context bar now appends cache hit rate with pipe (` # [#####-------] 39.6% · 416k/1.0M | c 85.3%` via `formatContextBar(..., cacheHitRate)` from `getUsageTotals`) and model/context are pipe-separated (`model | context` via dim `|`)
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
