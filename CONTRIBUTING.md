# Contributing to pi-editor-footer

## Conventional commits

- `feat[(scope)]: description` → MINOR, `fix[(scope)]:` → PATCH, `feat!:` / `BREAKING CHANGE:` → MAJOR
- Other types `docs|style|refactor|perf|test|build|ci|chore|revert` hidden unless `!`
- Scope is noun, description imperative present, lowercase, no period, ≤72 chars
- Enforced by `commitlint` + `husky` (`npx commitlint --from=origin/main --to=HEAD`)

## Changelog

`CHANGELOG.md` `## [Unreleased]` guarded by `pre-push` hook (`warn+block`, `uv run python scripts/changelog-unreleased.py update`) and `changelog-check.yml` (`pull_request` required); `release.yml` runs `scripts/changelog-unreleased.py clear` then `semantic-release` owns versioned sections. Do not hand-edit versioned sections. Commit the sync as a hidden type (e.g. `chore: sync changelog unreleased section`) — a visible type re-triggers the guard and loops forever. Hidden types only appear when `!`/`BREAKING CHANGE`.

## Before PR

`pnpm run lint && pnpm run format && pnpm run typecheck && pnpm test` must pass. See `AGENTS.md` for agent rules.
