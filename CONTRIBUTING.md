# Contributing to pi-editor-footer

## Conventional commits

- `feat[(scope)]: description` → MINOR, `fix[(scope)]:` → PATCH, `feat!:` / `BREAKING CHANGE:` → MAJOR
- Other types `docs|style|refactor|perf|test|build|ci|chore|revert` hidden unless `!`
- Scope is noun, description imperative present, lowercase, no period, ≤72 chars
- Enforced by `commitlint` + `husky` (`npx commitlint --from=origin/main --to=HEAD`)

## Changelog

`CHANGELOG.md` `## [Unreleased]` guarded by `pre-push` hook (`warn+block`, `uv run python scripts/changelog-unreleased.py update`) and `changelog-check.yml` (`pull_request` required); `release.yml` runs `scripts/changelog-unreleased.py clear` then `semantic-release` owns versioned sections. Do not hand-edit versioned sections. Commit the sync as a hidden type (e.g. `chore: sync changelog unreleased section`) — a visible type re-triggers the guard and loops forever. Hidden types only appear when `!`/`BREAKING CHANGE`.
### Release hygiene — the last two checks

Run these before asking for review; both are enforced (the first on every PR, the second by `changelog-check.yml` and now the `pre-push` hook).

```sh
pnpm install --frozen-lockfile                # 1. the install must match the pin
node --import tsx scripts/check-pinned-versions.ts
python3 scripts/changelog-gate.py ledger --pr <N>
```

The first one exists because a stale `node_modules` is indistinguishable from an API
change: a `@earendil-works/pi-tui` that drifted from the pinned version produced five
tsc errors and four failing suites in #44 while the code was correct. The guard names
the pinned version, the installed version and the fix, and `pinned-versions.yml` runs
it on every pull request (plus before the build in `release.yml`).

The ledger floor is what `changelog-check.yml` checks: every `[Unreleased]` bullet names
a `(#N)` that resolves, sections are known, no duplicate identities, no double attribution.
Before a PR exists there is no number to name yet, so the `pre-push` hook only warns;
once the PR exists it blocks the push. See `docs/reference/pi-tui-internals.md` for the
stale-tree signature that motivated the version guard.
## Reporting Issues

Pick the template that matches your intent — see `.github/ISSUE_TEMPLATE/` (blank issues disabled).

- Bugs: paste-complete, prefer text over screenshots.
- Features: state problem + proposal at minimum; alternatives optional.

## Before PR

`pnpm run lint && pnpm run format && pnpm run typecheck && pnpm test` must pass. See `AGENTS.md` for agent rules.

## Pull Requests

Prefer topic branch → PR → squash merge. Keep one concern per PR; link the issue with `Closes #NN`.

### Description

PR body is auto-populated from `.github/pull_request_template.md` (GitHub PR template). Keep the four headings — delete `Architecture` when no structural change:

- **Summary** — 2-3 sentences on *why*; include `**Impact**: X files (Y +, Z -) · **Risk**: Low | Medium | High`.
- **What Changed** — grouped by system/feature, not file list; flag migrations / API / payload-contract changes.
- **Architecture** — Mermaid before → after only for structural seams.
- **Checklist** — start from template checklist; add items as needed.

CI (`changelog-check.yml`, `verify`) must be green before requesting review.
