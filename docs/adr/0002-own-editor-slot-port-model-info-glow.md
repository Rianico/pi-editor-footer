# Own the single editor slot; port model-info-widget's border glow

Pi allows exactly one custom input editor — the last `setEditorComponent` writer wins. The user's `model-info-widget` extension also installs one on `session_start`, and its handler ran after ours, silently replacing the TrackingEditor and killing the detail window ("no popup" — the extension's render was never even called). We defer our install (`setTimeout 0`, after every other extension's synchronous `session_start` handler) plus a 1s watchdog that re-asserts ownership whenever the focused input editor is not ours, and we ported model-info-widget's border glow/label rendering into `src/model-info.ts` so its visual behavior survives even though its own editor install is now inert.

Status: accepted

## Considered Options

- **Let model-info-widget keep the slot**: impossible — highlight tracking must live on the owning editor; there is no API to observe the popup from outside.
- **Defer our install only**: fragile against other deferring extensions; the watchdog makes slot ownership self-healing.
- **Watchdog only**: works, but the first second of every session would run with the wrong editor.
- **Port the glow (chosen)**: keeps both features without touching model-info-widget's files; the port is self-contained (color math + label rendering, verbatim from the original).

## Consequences

- model-info-widget's editor install is now inert; its rendering lives in `src/model-info.ts`, and its `/model-info` toggle is reimplemented by pi-skill-desc's own `/model-info` command — so the widget can be deleted from `~/.pi/agent/extensions/`.
- Intentional code duplication with model-info-widget; a future cleanup could merge the extensions.
- The watchdog only fights input editors (CustomEditor duck-type: `actionHandlers` is a `Map`) — selectors, dialogs, and overlays are never disturbed.
