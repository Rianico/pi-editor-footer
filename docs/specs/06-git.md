# Spec: Git state

**Status**: superseded decision text replaced — current contract below.
**Ticket**: #13 (original) · #45 / #46 / #45b / #45c (rewrite)
**Type**: Decision
**Branch**: `feat/git`
**Related**: ADR-0003 (`docs/adr/0003-git-rail-follows-powerlevel10k-composition.md`), ADR-0002

## Problem

The footer needs the repository state to render its git rail, cheaply enough to refresh
every second. The original engine shelled out several times per refresh
(`rev-parse`, `rev-list`, `stash list`) and parsed porcelain v1, whose branch line loses
the branch name on a diverged branch (`## main...origin/main [ahead 1, behind 1]` did not
match the suffix regex) and on `[gone]`, and which cannot report an in-progress operation
at all.

## Decision

Read the state once, in the rail's own vocabulary.

**One read** — `src/git.ts`, `GIT_STATUS_ARGS`:

```
git status --porcelain=v2 -z --branch --show-stash --untracked-files=all
```

`-z` keeps path names unquoted and makes every field NUL-terminated; `--show-stash` is what
produces `# stash N`; `--untracked-files=all` counts untracked directories file by file.
A git build that rejects `--show-stash` (unknown option, exit 129) is retried once with
`PARTIAL_STATUS_ARGS` — the same read minus that flag — producing a partial rail rather than
degrading the whole repository to `(no git)`.

`GitStatus` carries only what the rail draws: `branch`, `commit { oid, detached, tag }`,
`staged`, `unstaged`, `untracked`, `stashed`, `behind`, `ahead`, `unmerged`. `deleted` and
`renamed` fold into the file counts; `modified` and `conflicted` are gone as kinds;
`hasGitChanges` and the `readCommit`/`readTag`/`readCounts` options are deleted.

Parsing rules (`parseGitStatus`):

| field | source |
|---|---|
| branch | `# branch.head` (`(detached)` means no branch) |
| commit oid | `# branch.oid` (`(initial)` on an unborn branch → null) |
| ahead / behind | `# branch.ab +N -M` — absent when there is no upstream, which is the `[gone]` case |
| stashed | `# stash N` |
| staged / unstaged | `1` and `2` records: X and Y of `XY` (`AM` counts in both) |
| untracked | `?` records |
| unmerged | `u` records — conflicts never leak into staged/unstaged |

A `2` (rename/copy) record is followed by its original path as a separate NUL field; that
field is a path, so it is skipped rather than read as a record.

**One conditional second spawn.** `git describe --tags --exact-match HEAD` runs only when
detached, and only to decorate the sha with a tag.

**One probe for the operation** — `src/git-action.ts`:

```
git rev-parse --git-path MERGE_HEAD --git-path rebase-merge --git-path rebase-apply \
               --git-path CHERRY_PICK_HEAD --git-path REVERT_HEAD --git-path BISECT_LOG
```

`--git-path` resolves markers the way git itself does, so linked worktrees and submodules
work without guessing at `.git/`. Two traps: the answer is **cwd-relative**
(`../.git/MERGE_HEAD` from a subdirectory), so it is resolved against the cwd before use;
and it prints a path whether or not the file exists, so existence is `stat`, never non-empty
output. Progress files differ per backend: `msgnum`/`end` (merge) and `next`/`last` (apply).

Precedence follows git-prompt.sh, which powerlevel10k follows — a rebase in flight outranks
everything:

| marker | label |
|---|---|
| `rebase-merge` + `interactive` | `REBASE-i n/m` |
| `rebase-merge` | `REBASE n/m`, or `REBASE` without progress files |
| `rebase-apply` + `applying` | `AM` |
| `rebase-apply` | `REBASE n/m` |
| `MERGE_HEAD` | `MERGING` |
| `CHERRY_PICK_HEAD` | `CHERRY-PICKING` |
| `REVERT_HEAD` | `REVERTING` |
| `BISECT_LOG` | `BISECTING` |

`actionLabel()` returns the bare label (`MERGING`, `REBASE 2/7`); `composeGitRail` owns the
`|` prefix and the uppercasing, so punctuation has exactly one owner.

## Failure discipline

`GitExecResult` is a discriminated union, because the *kind* of failure is load-bearing:

- `{kind:"ok", stdout}` — a real answer.
- `{kind:"failed", transient:true}` (timeout/killed, no exit code) — unknown state.
  `readGitStatus` resolves `null` and both orchestrator call sites keep the previous rail
  through `mergeGitStatus(last, next) = next ?? last`. No flicker to `(no git)`.
- `{kind:"failed", transient:false, code}` — git ran and answered. Exit 128 means "not a
  work tree", so the empty status is authoritative and the rail may say `(no git)`; pinning
  the last rail here would leave a stale branch on screen after `cd`-ing out of a repo.

A failed action probe is "no action": the label disappears, branch and counts keep rendering.
Nothing in the acquisition path throws.

## Rendering contract

Composition order and rules live in ADR-0003 and `composeGitRail`: `[COMMIT] [BRANCH] [TAG]
[STAGED] [UNSTAGED] [UNTRACKED] [BEHIND] [AHEAD] [STASH] [ACTION]`, single-space separated, no
brackets, bare at count 1 (except stash), behind before ahead, conflicts colour-only, tags only
while detached, counts suppressed while an action is live. Examples below are asserted in
`test/git-rail.test.ts` and `test/git-action.test.ts` (ascii glyph set):

```
clean                              main
staged 2, unstaged 1, untracked 3  main A2 ! ?3
+ behind 1, ahead 2, stash 1       main A2 v ^2 S1
unstaged 1 only                    main A2 !
detached, tag hidden (default)     9f2c1a8b
detached, gitCommit on             9f2c1a8b v0.13.0
mid-merge (0 or n unresolved)      main |MERGING
mid-interactive-rebase             main |REBASE 2/7
not a git repository               (no git)
```

## Consequences

- One spawn per refresh (two when detached), plus one probe for the action label.
- Diverged and `[gone]` branches keep their names; a detached HEAD shows its commit.
- Resolved-and-staged conflicts stay visible: the label outlives `unmerged > 0`, which is the
  half of the signal a colour-only rail could not carry.
- `gitCommit` gates only the tag; the sha is identity and rides on `gitBranch`.
- No config migration: `gitCommit` keeps its pre-ADR default (`false`).
