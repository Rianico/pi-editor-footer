# Spec 01 — Config Schema & Persistence

Ticket: #7 · Type: grilling (HITL) · Branch: `feat/config`

## Question

What is the single config contract every subsystem reads?

## Decision

- File: `~/.pi/agent/pi-skill-desc.json` (keep existing name for backward compat; identity rename may add alias — decide in #6).
- Shape:

```ts
export type WorkspaceDisplay = "path" | "name";
export type CursorStyle = "block" | "bar" | "underline";
export type IconMode = "auto" | "nerd" | "ascii";

export interface ThemeConfig {
  enabled: boolean;
  workspaceDisplay: WorkspaceDisplay;
  cursorStyle: CursorStyle;
  icons: { mode: IconMode };
  telemetry: {
    enabled: boolean;
    tps: boolean;
    ttft: boolean;
    duration: boolean;
    tokens: boolean;
    stalls: boolean;
    cost: boolean;
  };
  footerSegments: {
    cwd: boolean;
    sessionName: boolean;
    gitBranch: boolean;
    gitStatus: boolean;
    gitCommit: boolean;
    runtime: boolean;
    context: boolean;
    tokens: boolean;
    cost: boolean;
    extensionStatuses: boolean;
  };
}
```

- Defaults mirror `tmp/pi-open-tui` DEFAULT_CONFIG except `workspaceDisplay` defaults to `"path"`, `icons.mode` to `"auto"`.
- Helpers: `loadConfig()`, `saveConfig(patch)`, `DEFAULT_CONFIG`, validation (Zod or manual) at admission boundary; typed inside.
- Live reload: `saveConfig` writes file + notifies `requestRender` / re-apply cursor/style.

## Acceptance

- [ ] `src/config.ts` exists, typed, validated at load, with `loadConfig`/`saveConfig`/`DEFAULT_CONFIG`
- [ ] Malformed file falls back to defaults with warning, never crashes
- [ ] `workspaceDisplay` controls header/footer cwd rendering (consumers read it)
- [ ] `npm run typecheck` passes, unit test for load/save + defaults
