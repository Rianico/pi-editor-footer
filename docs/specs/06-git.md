# Spec 06 — Git State Engine

Ticket: #13 · Type: task (AFK) · Branch: `feat/git` (or part of `feat/footer`) · Blocked by #10

## Question

Which rich git states does the footer's git segment surface, and how are they computed?

## Decision

> **Superseded by ADR-0003 (ticket #45).** The `GitStatus` shape and the multi-command
> detection recorded below are the historical decision. The rail now follows
> powerlevel10k's composition and `readGitStatus` performs a single
> `git status --porcelain=v2 -z --branch --show-stash --untracked-files=all` read, plus
> `git describe --tags --exact-match` only while detached. `deleted`/`renamed` fold into
> `staged`/`unstaged`, `modified`/`conflicted` are gone as kinds, and divergence comes
> from the `# branch.ab` header rather than a branch suffix. Current contract:
> `src/git.ts` and `docs/adr/0003-git-rail-follows-powerlevel10k-composition.md`.

Rebuild `tmp/pi-open-tui/extensions/open-tui/git.ts` bespoke. Expose:

```ts
interface GitStatus {
  branch: string | null;
  commit: { oid: string; tag: string | null; detached: boolean } | null;
  ahead: number; behind: number;
  staged: number; modified: number; untracked: number;
  conflicted: number; stashed: number;
}
function readGitStatus(cwd: string): Promise<GitStatus>
function emptyGitStatus(): GitStatus
```

- Detection via `git` CLI (`git rev-parse`, `git status --porcelain`, `git rev-list --left-right`, stash list). No `isomorphic-git` dep.
- Handles detached HEAD (show short oid + tag), ahead/behind, staged/modified/untracked, stashed.
- Cached + debounced (don't spawn git on every render; refresh on interval + on demand from footer).
- Theme glyphs for each status via `icons.ts` (`resolveGlyphs`).

Blocked by footer wireframe (git segment shape). AFK.

## Acceptance

- [ ] `src/git.ts` with `readGitStatus` + tests (mock git)
- [ ] Footer consumes it via `FooterState.git`
- [ ] `npm run typecheck` + `npm test` pass
