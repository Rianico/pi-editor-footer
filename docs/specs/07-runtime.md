# Spec 07 — Runtime Detection

Ticket: #14 · Type: task (AFK) · Branch: `feat/runtime` (or part of `feat/footer`) · Blocked by #10

## Question

What is the runtime-signature catalog the footer's runtime segment recognises?

## Decision

Rebuild `tmp/pi-open-tui/extensions/open-tui/runtime.ts` bespoke.

```ts
interface RuntimeInfo { name: string; version?: string; icon: string }
function readRuntimeInfo(cwd: string): Promise<RuntimeInfo | null>
```

- Catalog: at least 10 common runtimes (node, python, rust, go, ruby, java, deno, bun, etc.) detected via lockfiles/config presence (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, etc.) — subset of 50+ is acceptable for v1, expand later.
- Priority order: explicit lockfile > version file (`.nvmrc`, `.python-version`) > generic.
- Glyph via `icons.ts` / `runtimeSymbol` helper, respects `icons.mode`.

Blocked by footer wireframe. AFK.

## Acceptance

- [ ] `src/runtime.ts` + unit tests (fixture dirs)
- [ ] Footer consumes via `FooterState.runtime`
- [ ] `npm run typecheck` + `npm test` pass
