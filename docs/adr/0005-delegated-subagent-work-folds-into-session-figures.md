# Delegated subagent work folds into the session figures through one union and one dedupe

Delegation is now ordinary usage: one prompt can hand most of its work to subagents that run in
their own pi sessions, so the chrome under-reports — the top-rule run time sums the parent's
`agent_start` → `agent_settled` windows and never sees a background child that ran while the
parent sat idle, and the footer/timeline `↑/↓/$` read the parent's session entries, where a
child's tokens never appear. The fix is one new toggle (`subagentUsage`, default on) over two
precise rules: wall time is the **union** of intervals, and usage is counted **once per child**
across the channels that can deliver it.

Status: accepted (revision 2)

## Considered Options

- **Sum child durations onto the parent's run time** — rejected. A foreground delegation is a
  synchronous tool call: the child's window is *inside* the parent's, so summing counts the same
  seconds twice and breaks the one figure the field has always meant ("how long has this session
  actually run?"). Two background children started together would likewise bill 2N for N seconds
  of wall clock. Union is the only arithmetic that keeps both invariants.
- **Read the child session files** (`session.jsonl` per child) to compute usage — rejected.
  It couples us to pi's on-disk session layout and to every file being present, flushed and
  complete; the extension already publishes both the launch/completion events and the per-child
  usage block, which is a supported surface.
- **A separate footer segment for delegated usage** (for example `+2 subagents`)** **— rejected.
  The intent is that delegated work *is* the session's work; a second figure invites the reader
  to add two numbers that are already one. One toggle, no new field, no layout change.
- **Gate the data layer by the display toggle** (stop recording when `subagentUsage` is off) —
  rejected, same reasoning as `sessionRunTime`: history collected while the display was off would
  be lost forever, and a later turn-on would silently under-report. The toggle gates *reads*.
- **Make `pi-subagents` a dependency, or detect it by name** — rejected. It is optional and
  version-sensitive; a missing extension or event bus must change nothing. Detection is by
  payload *shape* and by merely subscribing to channels nobody may publish on.

## Consequences

- **Wall time is a union of half-open intervals.** `SessionRunTimeAccumulator` keeps the parent
  run and each `subagent:async-*` window as owned intervals, merges overlaps, and adds only the
  uncovered part. A foreground delegation therefore leaves the figure untouched; a background
  child extends it by exactly its uncovered window; concurrent children cost the clock once.
  `snapshot(now, { includeSubagent })` returns the child-inclusive figure by default and the
  parent-only figure when the toggle is off, so "off" is the same number a session with no
  subagent extension shows.
- **Only closed intervals are persisted.** `session-run-time` keeps storing cumulative seconds;
  an in-flight window is never written, so a resume cannot double-count a run it could not
  measure. A resumed session seeds from the last entry and continues from there.
- **The two scopes are rendered, so both are persisted.** `session-run-time` stores
  `{ seconds, parentSeconds }`. Restoring only the inclusive figure would leave the
  toggle-off question unanswerable: the accumulated seconds already contain the child
  windows and cannot be split back into parts. `snapshot(now, { includeSubagent: false })`
  therefore reads the parent base, `true` reads the inclusive base, and each keeps
  accumulating its own closed intervals afterwards.
- **A legacy entry falls back, and the fallback is stated rather than hidden.** Entries
  written before revision 2 carry `seconds` only. The split is not in the history, so the
  inclusive figure answers both questions: after such a resume, **toggle off shows the
  pre-resume figure inclusive of the child windows that were recorded before the resume**.
  That is the honest reading of incomplete history, not the "off == no-extension" identity,
  which only holds for sessions whose entries all carry the pair. Fresh sessions, and every
  entry written from revision 2 on, keep the identity exactly.
- **A corrupt entry is skipped, never treated as an empty history.** Both restores scan
  backwards for the last *usable* entry: a truncated or foreign-schema payload (missing
  `seconds`, non-numeric or negative, non-array `records`) falls through to the valid
  cumulative entry behind it, so one bad tail write cannot erase a session's history.
  An *empty* record array is a real empty set, not corruption; a **non-empty** array whose
  every element fails sanitization (no key) is corruption and is skipped like any other.
- **Usage is one record per child, keyed by `<runId>#<index>` (or the sole run id).** Every
  channel that redelivers a child upserts the same key instead of adding, and a record whose
  parent `toolCallId` already carries usage on its `toolResult` session entry is dropped at fold
  time — pi core bills that aggregate itself, so the same child is never counted twice. This is
  the dedupe the ">1 channel" requirement names.
- **Persistence is a second custom entry, `subagent-usage`, holding the cumulative record list
  (last entry wins).** The totals fold (`getUsageTotals`) reads only the last one, so appending
  after every child cannot inflate the totals, and a resumed session reproduces both the run time
  and the usage without a re-read of the child sessions.
- **The toggle gates reads, at every production call site** — `getUsageTotals(ctx, { includeSubagentUsage })`
  from the footer, the chrome snapshot and the timeline, and `snapshot({ includeSubagent })` for
  the run-time field. Defaults are on; each site passes its config explicitly so "off" is a
  decision and never an omission.
- **The optional integration stays optional.** `pi.events` may be absent; when it is, nothing is
  subscribed, nothing throws, and the parent-only figures are emitted byte for byte. Subscriptions
  are torn down on dispose, so a session reload cannot leave a listener behind.
- **The split between the two scopes is one decision, stated once here:** delegated children
  fold into exactly two rendered figures — **Session run time** (their windows join the union)
  and the **footer's session totals** (`↑/↓/$`, *what this session billed*). Everything else
  stays parent-scope and is toggle-independent by construction: the **top-rule context** comes
  from the parent window's `contextUsage`, and its **cache** figure is `latestCacheHitRate`,
  derived from assistant turns alone (`addSubagentRecord` never touches it), so a child record
  cannot move one byte of that field. The **timeline run row** answers *how much this Agent run
  moved* (ADR-0004 revision 3) and keeps the run's own figures — a background child is not part
  of that run at all, and the row's no-telemetry fallback reads parent-scope totals too.
  `test/subagent-usage.test.ts` pins both sides of that split on the same session — the run row
  against folded entries, and the top-rule string with and without a folded child — so it reads
  as a decision rather than an oversight.
- **The run row's fallback is run-scoped too.** When authoritative telemetry is missing (a run
  aborted before its first turn, a telemetry gap) the row falls back to session totals, and
  those are the folded ones — so the fallback reads a second, parent-only read of the same
  entries, and the Agent-run baseline captured at `agent_start` is that parent-only figure. A
  `tel`-present settle therefore pays no second scan; a `tel`-absent settle pays one, cached
  under its own key.
- The external contract (channels, payload shapes, the installed version they were verified
  against) is recorded in `docs/reference/pi-subagents-events.md`; that file, not this ADR, is
  what to re-run when `pi-subagents` changes shape.
