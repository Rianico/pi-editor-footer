# Spec 03 — Editor Border: Model-Label Top + Telemetry Bottom Right (+ Telemetry Engine + Cursor)

Tickets: #8 (prototype), #12 (telemetry engine), #11 (cursor) · Branches: `feat/border-telemetry`, `feat/cursor` (may merge)

## Questions

- How do model label (top) and telemetry (bottom right) share the editor border?
- What pi events produce the six measurements?
- How do cursor styles fold into TrackingEditor?

## Decisions

### Border Layout

- `TrackingEditor.render(width)` decorates `super.render(width)` lines:
  - Top border hosts model-info label + thinking glow (`applyModelInfo` preserved, reads live `Theme` via `getLiveTheme()`).
  - Bottom border hosts telemetry segment right-aligned, theme-respecting, truncated with `truncateToWidth`.
  - Both survive narrow widths: left truncated first, right telemetry priority.
- Model top and telemetry bottom do not collide — prototype sketch required for sign-off.

### Telemetry Engine

Rebuild `tmp/pi-open-tui/extensions/open-tui/telemetry.ts` bespoke:

```ts
class TelemetryTracker {
  handle(event: TelemetryEvent): TurnTelemetry | undefined
}
```

- Events: `agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `turn_end`, `agent_settled`, `tool_execution_start`.
- Metrics: `tps` (output tokens / generationMs), `ttftMs`, `totalMs`, `inputTokens/outputTokens`, `stallCount/stallMs` (stall = gap > 1000ms between updates), `costUsd` + `rateUsdPerMTokens` from `usage.cost.total`.
- Provider seam: tracker exposes `getLastTelemetry(): TurnTelemetry | null` for border + footer.
- Theme glyphs via `icons.mode` (`resolveGlyphs`).

### Cursor Styles

- Fold `tmp/pi-open-tui/.../editor.ts` cursor logic into `TrackingEditor`:
  - `cursorStyle: "block"` (default, software cursor), `"bar"` (`\x1b[6 q`, hardware cursor), `"underline"` (`\x1b[4 q`).
  - `setCursorStyle(style)` + `config.cursorStyle` wiring.
  - Bar/underline suppress software cursor marker, enable `tui.setShowHardwareCursor(true)`, write sequence.

## Acceptance

- [ ] `src/telemetry.ts` pure tracker with unit tests (TPS/TTFT/stall maths, fixtures)
- [ ] `TrackingEditor` supports `cursorStyle`, toggled via config, no break to highlight tracking
- [ ] Border renders model top + telemetry bottom-right, respects live theme, truncates correctly
- [ ] `npm run typecheck` + `npm test` pass
