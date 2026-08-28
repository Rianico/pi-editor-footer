# Contributing to pi-editor-footer

## Conventional commits

- `feat[(scope)]: description` → MINOR, `fix[(scope)]:` → PATCH, `feat!:` / `BREAKING CHANGE:` → MAJOR
- Other types `docs|style|refactor|perf|test|build|ci|chore|revert` hidden unless `!`
- Scope is noun, description imperative present, lowercase, no period, ≤72 chars
- Enforced by `commitlint` + `husky` (`npx commitlint --from=origin/main --to=HEAD`)

## Changelog

Do not edit `CHANGELOG.md`. Changelog entries are added by maintainers on `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin vX.Y.Z` (tag triggers `release.yml`).

## Before PR

`npm run lint && npm run typecheck && npm test` must pass. See `AGENTS.md` for agent rules.
