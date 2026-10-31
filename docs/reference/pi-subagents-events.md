# pi-subagents integration — the external contract this extension reads

Ticket: #66 · Installed version at time of writing: **pi-subagents 0.83.1**
(`~/.pi/agent/npm/node_modules/pi-subagents`).

`pi-subagents` is **not** a dependency: it is an optional third-party extension. This
document is the sync contract. When it changes, `src/subagent-usage.ts` and the
`subagent:*` handlers in `src/session-orchestrator.ts` are the only code that must follow,
and every figure must degrade to the parent-only numbers rather than error.

## Why the parent cannot simply read its own session

A delegated child runs in **its own pi session** (a separate `session.jsonl` file), so no
parent session entry carries the child's tokens. Setting `result.usage` on the tool result is
the only route into the parent's entries, and pi-subagents only does that for some foreground
paths. The extension therefore reads two payload channels itself and persists what it finds.

## Channel 1 — foreground tool result (`tool_execution_end`)

`pi.on("tool_execution_end")` → `event.result.details`:

```text
details = {
  mode: "single" | "parallel" | "chain" | "workflow" | "management",
  runId?: string,                       // not present in older payloads
  results: [
    { agent, usage: { input, output, cacheRead, cacheWrite, cost: number, turns }, ... },
  ],
}
```

- One child per `results[]` entry, `usage.cost` is a **number** here (not `{ total }`).
- `mode: "management"` and an async **launch** both return `results: []` — nothing to record.
- Verified shape: `src/runs/foreground/subagent-executor.js` (`withAggregatedToolUsage`).

**Cross-channel trap:** pi core copies the aggregate `result.usage` onto the `toolResult`
session entry (`agent-session.js:_afterToolCall` → entry `message.usage`), and
`getUsageTotals` already counts that. A record whose parent `toolCallId` appears on a
`toolResult` entry that carries usage is therefore dropped at fold time — one child, one
channel, never twice.

## Channel 2 — the event bus (`pi.events`)

`pi.events` is a string channel bus (`dist/core/event-bus.d.ts`: `on(channel, handler)`
returns an unsubscribe function). Channels read:

| Channel | Emitted from | Read for |
| --- | --- | --- |
| `subagent:async-started` | `runs/background/async-execution.js` (launch) | run id → open the child's wall-clock interval |
| `subagent:async-complete` | `runs/background/result-watcher.js` (completion) | run id → close the interval, plus `results[].usage` |

`subagent:async-complete` payload (a completion result file spread into the event):

```text
{
  runId, id, agent, mode, state: "complete" | "failed" | "stopped", success,
  results: [ { agent, usage: { input, output, cacheRead, cacheWrite, cost, turns }, ... } ],
  totalCost?: { inputTokens, outputTokens, costUsd },   // fallback, no cache split
}
```

- Neither payload carries a timestamp, so an interval's ends are the **event receipt**
  times (`Date.now()`); the events are emitted at the launch and completion boundaries.
- `usage.cost` is a number; the `totalCost` fallback has no `cacheRead`/`cacheWrite`.
- `subagent:child-status`, `subagent:process-terminal`, `subagent:foreground-complete`
  and the `subagent:*` slash channels are **not** read: the first three duplicate
  completion identity or window nothing, the last are UI request/response plumbing.

## What we persist

Two custom session entries, both cumulative and last-entry-wins:

- `session-run-time` — `{ seconds, parentSeconds }`: the **union** of parent and child
  intervals, and the parent-only union. Both scopes ride along because a restored inclusive
  total cannot be split back into its parts; a reader that finds no `parentSeconds` (an entry
  written before revision 2 of ADR-0005) falls back to `seconds` for both.
- `subagent-usage` — `{ records: [{ key, toolCallId?, input, output, cacheRead, cacheWrite, cost }] }`.

Both restores scan backwards for the last *usable* entry, so a truncated tail write cannot
erase a valid history behind it; an all-junk `records` array counts as corrupt, an empty one
as a real empty set.

Both are appended unconditionally (the data layer never consults the `subagentUsage`
display toggle), so history survives a toggle change and a resume.

## Verification recipe

1. `node --import tsx --test test/subagent-usage.test.ts` — payload extraction, union,
   dedupe, resume and toggle-off all run against recorded payload shapes.
2. Live, if the extension is installed: `pi --no-session -nc -ne -ns -nt -nbt -e src/index.ts`,
   delegate one short task in the **background**, and compare the top-rule run time and the
   footer `↑/↓/$` against the child's reported duration/usage
   (`.../pi-subagents-uid-<uid>/async-subagent-runs/<runId>/status.json`:
   `startedAt`, `endedAt`, `totalCost`).
3. Toggle **Subagent usage** off in `/pi-editor-footer` → both figures must return to the
   parent-only values with no layout change.
