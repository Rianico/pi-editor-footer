# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.9.0] - 2026-08-27

### Added

- Incremental per-agent_run live input accounting — `trigger+Σ(outputs+tools)+liveDelta` per run (`~` during live, authoritative `deltaFromBaseline` after), `AgentRunLedger` owns `triggerTokens/accumOutput/accumTool` reset in `startRun`, `getIncrementalLiveDisplayTotals`/`getIdleAuthoritativeDisplay` (grill Q6→a Q7→b Q8→a Q9→a Q11→a)

### Changed

- `turn_start` input now synthetic `trigger+Σ` (independent per run) instead of `getContextUsage` window; `tool_result`/`tool_execution_end` fold `chars/4` into accumulation; `LiveBorder` top `↑` hybrid (`~` live, no `~` idle), context bar stays real window (Q10); co-coded with `typescript-expert` (`unknown` boundaries, `SAFETY` on pi seams)

## [0.8.0] - 2026-08-26

### Added

- ~ prefix for live estimate — `TurnTelemetry.estimated` and `AgentRunLedger` propagation, `↑ ~1k · ↓ ~2k` and `~42.1 tok/s` while streaming vs authoritative after `turn_end` (#29)

### Changed

- TPS whole-turn stable rate — absorb `pi-core-tps-stats` one-rate `output / turnDuration` (41/14/55 vs window 263/801/89), live and final share denominator, `CONTENT_START_EVENTS` for TTFT, reset on `model_select` (#29)
- Collapse Agent-run timeline into one seam — `TranscriptTimeline` now owns history, formatting (`buildTimelineText`), injection and rebuild replay; `SessionOrchestrator` wallTimeHistory deleted, seam turns hypothetical → real with two adapters (prod `chatContainer` + in-memory fake) (#23)
- Prune LiveBorder fallback — `AgentRunLedger` required, 80-line manual delta deleted, single `ChromeComposition` cached per `render()` (#24)

### Fixed

- Delete dead `SessionKernel` (255 lines, 0 adapters) and ghost `liveTickTimer` wrappers — `SessionOrchestrator` calls `LiveBorder.startTick/stopTick` directly (#27)
- pi-lens `SAFETY` comments for `as unknown as` casts (#29)

### Refactored

- Table-driven config validation — `CONFIG_SCHEMA` single source for defaults + validation; removes 10 `as unknown as` casts, `theme-settings` trusts typed boundaries (#25)
- Retire TrackingEditor compat wrappers — `setChrome`/`getChrome` is the single interface; 7 wrappers + 2 glow accessors deleted, codemod `LiveBorder`/`SessionOrchestrator` (#26)

## [0.7.0] - 2026-08-25

### Changed

- Deepen architecture — 5 candidates behind single seams: AgentRunLedger owns per-agent capping and max-vs-sum (C2), ChromeComposition centralizes glyph/theme (C3), TurnTelemetryTracker turn-scoped with ledger delegation (C4), DetailChrome owns Highlight→Detail window (C5), SessionOrchestrator owns lifecycle, footer deduplication and detail wiring — `src/index.ts` 899→93 lines, 139 tests (+52) (#20)

## [0.6.2] - 2026-08-25

### Fixed

- Live `↑` no longer exceeds context window or session total — `telemetry:peekAgentLive` and `endAgent` now use peak window (`max`) for `inputTokens` not sum (summing `50k+60k=110k` double-counted overlapping history `> 60k` window), `live-border` top `↑` now shows current window `peekLive` + per-agent `output`/`cost` capped to `contextUsage.tokens`, idle also via telemetry `max` capped, timeline `↑` prefers telemetry `max` capped

## [0.6.1] - 2026-08-25

### Fixed

- Live `↑` now per-agent delta (`279k-261k=18k` for 10 turns) not session total — `live-border` top `↑`/`↓` when idle uses `totals - baseline` at `agent_start` (`LiveBorder.setAgentBaseline`), timeline `↑`/`↓`/`$` also prefers baseline delta; when running uses per-agent sum via `telemetry:peekAgentLive()` which now always resets on `agent_start` (removed stale `if (agentStartMs===null)` guard) and handles `agent_end` alias for `agent_settled`

## [0.6.0] - 2026-08-24

### Changed

- Context usage colors now `12.5%`/`25%`/`50%` quotas — `dim` 0-12.5 → `accent` 12.5-25 → `warning` 25-50 → `error` 50-100 via `color-policy:contextUsageColor` (was `25%`/`50%`/`75%`), respects theme semantic tokens
- Live `↑`/`↓` tokens now per agent run (option B) — cumulative across turns in this agent via `telemetry:peekAgentLive()` + `live-border` top `↑`/`↓` (was per-turn via `getLastTurnTelemetry`), `getLastTelemetry` stays agent sum
- Stall relocated from bottom telemetry to top right of tool use with `dim |` pipe — `run-activity` now `tools | !2×3.3s` top, bottom `telemetry:formatTurnTelemetry` now `TPS · TTFT` only (suppressed `stalls:false`)

## [0.5.0] - 2026-08-22

### Changed

- Remove duration section positioned to the right of `TTFT` in bottom telemetry (`telemetry:formatTurnTelemetry` now `TPS · TTFT` only, `duration` config ignored)
- Use `<number> turns` to replace `T<number>` in top run-activity (`run-activity:formatRunActivityTopRight` now `1 turns` / `N turns` instead of `T1`/`T N`)
- Exchange positions of cache rate section (`c %`) and context bar section (`pct · tokens/window` + bar) in top border — now `c % | pct · tokens/window` instead of `pct · tokens/window | c %` (`chrome-state:formatContextBar`)

### Fixed

- Clamp live TPS window and throttle `LiveBorder` for multi-turn runs
- Add inline `SAFETY` for live-border casts (pi-lens)

## [0.4.0] - 2026-08-22

### Added

- Tiered context usage colors — `contextUsageColor(pct)` with 25%/50%/75% thresholds (`dim` <25 → `accent` 25–50 → `warning` 50–75 → `error` ≥75) applied to both `percent` and `tokens/window` sections and to bar/icon, so low usage stays dimmed and high usage highlights for quota visibility (`color-policy`, `chrome-state:formatContextBar`, `utils` barrel)
- Deepened architecture — candidates 1–5 (`TrackingEditor`, `TranscriptTimeline`, `LiveBorder`, `ChromeState`, `SessionKernel`) behind single seams, plus sync contract extension for transcript timeline seam (candidate 2)
- Telemetry formatting — `TPS`/`TTFT` with units and fixed width (`60.6 tok/s TPS`, `2.5s TTFT`), default tokens at start, and `↑`/`↓` relocated to right of cache with `|` separator

### Changed

- Hide `↑`/`↓` tokens at startup (only after `turn_start` via `liveInputTokens`)
- Dim line padding and fixed-width `TPS`/`TTFT`/`duration` with gradual TPS decay (half-life ~5s, reset after 2s idle)

### Fixed

- Reset TPS to default after 2s without incoming tokens before first token
- Interleave timeline in transcript (`chatContainer` injection, left-aligned dim `·`/`↑`/`↓`/`c`/`$` with `|`, close right) and correct `pi` extension path (`src/index.ts`)
- Satisfy `pi-lens` blocking — `SAFETY` comments for `as unknown as` casts (including `chrome-state`, `live-border`) and best-effort catches

## [0.3.0] - 2026-08-21

### Changed

- Timeline format now two-line dim per user spec: `2026-08-21 13:48:46 GMT+8 · 11s · ↑ 495 · ↓ 708 · c 85.3% · $0.00` + `3 turns · 5 tools · 1 failed` (datetime with timezone via `Intl` `en-CA` `short` TZ, wall `formatDuration`, `↑`/`↓` `fmtTokens`, cache `glyphs.cacheHit` `latestCacheHitRate`, cost `$`, turn/tools/failed from `runActivity` snapshot)
- Dimmed timeline now in transcript between runs — `User: hello? / Assistant: hi. / <dim timeline>` left-aligned dim, injected into `chatContainer` (scrollable) via `InteractiveMode` patch, not `aboveEditor` widget, so it sits between each `User/Assistant` pair and scrolls with history
- Dimmed timeline between each agent run in transcript — `chatContainer` injection `User/Assistant/<dim timeline>` left-aligned dim `· 8s wall · ↑ 1.2k · ↓ 800 · $0.12` via `InteractiveMode` patch (not `aboveEditor` widget), one per `agent_settled` per `timeline.*`, permanent in scroll history, never exposed to model (between transcript bottom and input), one per `agent_settled` (`· 8s wall · ↑ 1.2k · ↓ 800 · $0.12`), permanent between runs, never exposed to model (pi-tui only exposes `aboveEditor`/`belowEditor` widgets, so stacking aboveEditor is the non-exposing compromise)
- Wall time dim line left aligned and permanent between `agent_end` and next `agent_start` (`aboveEditor` `· 8s wall · ↑` dim left, not centered, stays in gap, never exposed)
- Dim line after `agent_end` now with specified timeline metrics (`timeline.enabled`/`wallTime`/`tokens`/`cost` in `ThemeConfig`, `Timeline` tab in `/pi-editor-footer` settings) — `· 8s wall · ↑ 1.2k · ↓ 800 · $0.12` dim aboveEditor, never exposed to model
- Wall time dim line after `agent_end` now positioned after last agent message in transcript (`aboveEditor` widget `· 8s wall · ↑ 1.2k · ↓ 800 · $0.12` dim, not footer second line) — visible right after `agent_end` message, hidden on next `agent_start`, never exposed to model
- Wall time dim line after `agent_end` now a separate footer row (was inline `cwd · wall`) — now `line1: cwd · runtime | ↑·↓·$` and `line2: · 8s wall · ↑ 1.2k · ↓ 800 · $0.12` dim, so timeline is visible
- Tokens separator now `·` not `|` (`↑ 1.2k · ↓ 800 · $0.12` in footer stats and `· 8s wall · ↑ · ↓ · $` dim line)
- Settings window title aligned to repo name `pi-editor-footer Settings` (was `pi-lsz-theme Settings`) and slash command renamed `pi-footer` → `pi-editor-footer`
- Tokens/cost relocated from telemetry bottom to wall time dim line — bottom now `TPS 4.0 tok/s · TTFT 4.0s · 5.0s` (no `↑`/`↓`/`$`), dim line after `agent_end` is `· 8s wall · ↑ 1.2k · ↓ 800 · $0.12` (all `dim`, TUI-only, never exposed to model, via `FooterState.lastDoneIn` + `getUsageTotals` gated by `telemetry.tokens`/`cost`)
- Git branch never folded — `renderGitSegment` no longer `truncateBranch(…,20)`, full `feature/very-long-…` shown; priority `6` (> cwd `5`) so `fitSegmentsByPriority` never omits branch before cwd/runtime/stats
- Telemetry TPS display throttled to 1 s (data vs display separated) — `message_update` now only updates `liveDeltaChars`/`liveEstimatedTokens` in `TurnTelemetryTracker`, display `peekLive()` → `formatTurnTelemetry` only via `liveTickTimer` every `REFRESH_MS` and `message_start`/`end`/`turn_end`/`agent_settled` for approximately accurate TPS without per-delta TUI jank
- Telemetry cost toggling `telemetry.cost` off/on no longer resets cost to `$0.00` — `refreshLiveTelemetry` now falls back to `getLastTelemetry()` when `peekLive()` is null (idle) and `onConfigChanged` calls `refreshLiveTelemetry()` immediately
- Refresh rate set to one second (`REFRESH_MS = 1000` for `liveTickTimer` telemetry/top/context and `watchTimer` editor ownership watchdog, was hardcoded `1000`)
- Context icon bar now switchable via config `contextIconBar` (default `false` disabled) — `0.0% · 0/1.0M | c 0.0%` by default, `# [████░░] 39.6% · 416k/1.0M | c 85.3%` when enabled (footer top, `nerd`/`ascii` glyphs)
- Context bar format now `0.0% · 0/1.0M | c 0.0%` (was `# [#####-------] 39.6% · 416k/1.0M | c`; no icon/bar, compact `pct · tokens/W`)
- Context bar and cache now follow icon mode (`nerd` ``/``/`█` vs `ascii` `#`/`c`/`#`) — `refreshContextBar` called in `onConfigChanged` so top `# [...] | c` updates immediately when `icons.mode` changes
- Telemetry `>`, `~`, `+` glyphs removed (`TPS 60.6 tok/s · TTFT 2.5s · 8.3s · ↑395 · ↓505 · $0.16` not `> TPS … · ~ TTFT … · +8.3s`)
- Telemetry bottom border compacted (`TPS 60.6 tok/s · TTFT 2.5s · 8.3s · ↑395 · ↓505 · $0.16` not `> TPS 60.6 tok/s | ~ TTFT 2.5s | + 8.3s | ↑ 395 | ↓ 505 | $0.16`; `TPS`/`TTFT` labels preserved, no space after `↑`/`↓`, joiner `·` not ` | `, stall `!2·3.3s` not `! stall 2x / 3.3s`)
- Footer cache omitted to the right of input/output (`↑ 395 | ↓ 505 | $0.16` not `| c 85.3%`; cache remains only in top context bar `# [...] | c 0.0%`)
- Nerd mode cost now `$0.00` not ` $0.00` (always single `$` in both footer `renderFooter` and telemetry `formatTurnTelemetry`, was `glyph === "$" ?`$ / ` : `glyph $` -> ` $`)
- Cache session now always shown with zero value (`c 0.0%` in footer `↑ | ↓ | $ | c` and `| c 0.0%` in top context bar) instead of hidden when no cache tokens
- Footer cost now `toFixed(2)` (`$0.16` not `$0.160`) and moved directly after input/output (`↑ 395 | ↓ 505 | $0.16 | c 85.3%` not `c | $`; `theme.fg("dim","|")` pipe)
- Top border model label no longer shows context window (`provider/model · thinking` not `· 1.0M`; `buildLabel` ignores `contextWindow`)
- Context bar now appends cache hit rate with pipe (`# [#####-------] 39.6% · 416k/1.0M | c 85.3%` via `formatContextBar(..., cacheHitRate)` from `getUsageTotals`) and model/context are pipe-separated (`model | context` via dim `|`)
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
