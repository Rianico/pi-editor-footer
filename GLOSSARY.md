# pi-editor-footer

A pi coding-agent extension that augments the built-in slash-command completion with a full description preview for the highlighted candidate.

## Language

**Completion popup**:
Pi's built-in slash-command tab-completion list (`/` + tab), which lists commands, tools, and skills with truncated descriptions.
_Avoid_: autocomplete, picker

**Candidate**:
An item in the completion popup — a skill, a tool, or a slash command.
_Avoid_: suggestion, entry, item

**Detail window**:
The extension's popup above the input box that mirrors the completion popup's highlight. Capped at 5 lines, scrollable with shift+up/down, showing the full description of the highlighted candidate.
_Avoid_: description window, tooltip, preview

**Highlight**:
The row currently selected in the completion popup. The detail window mirrors it — cycling the highlight swaps the window's content.
_Avoid_: selection, cursor

**Editor slot**:
The single custom-editor position in pi — the last `setEditorComponent` writer wins. pi-skill-desc must own it to observe the popup (ADR-0001, ADR-0002).
_Avoid_: editor position, editor hook

**TrackingEditor**:
This extension's custom editor — the actual input editor in the box. Replaces pi's `CustomEditor` (replicated inline) and adds popup-highlight observation plus the model-info border glow.
_Avoid_: custom editor, wrapper

**Agent run**:
One `agent_start` → `agent_settled` lifecycle for a single user prompt. Contains one or more **Turn**s (each `turn_start` → `turn_end` = one LLM call). The dim timeline row (`· 8s wall · ↑·↓·$`) is rendered once per agent run, between `agent_end` and the next `agent_start`. _Also called agent loop. Distinct from **Pi session** (`session_start` → `session_shutdown`, the whole TUI lifetime)._
_Avoid_: agent session, agent round (round ≡ turn confusion)

**Turn**:
One `turn_start` → `turn_end` = one LLM call inside an **Agent run**. `TTFT`/`TPS` are per-turn; wall time is per-agent-run.
_Avoid_: round, iteration

**Session run time**:
The cumulative wall time of every **Agent run** in the current **Pi session** — each run's `agent_start` → `agent_settled` duration, tool execution included, aborted runs counted up to the abort, idle time between runs excluded. Rendered as the rightmost field of the editor frame's top rule (e.g. `2h 32m 1s`) and persisted with the **Pi session**, so resuming continues the accumulated count.
_Avoid_: total duration, turns' time (a **Turn** is one LLM call, not a run), session wall clock

**Git rail**:
The footer's git segment, immediately right of the cwd: branch glyph (nerd only — p10k's ascii set has none) + branch, or the short commit sha when HEAD is detached (plus the tag when `gitCommit` is on), then powerlevel10k's ordered parts — staged, unstaged, untracked, behind, ahead, stash — space separated with no brackets, a part rendered bare when its count is 1 (stash is the exception and always counts), conflicts shown by colour alone (ADR-0003).
_Avoid_: git status block, branch segment, git widget

**Git action**:
An in-progress git operation the **Git rail** reports instead of the change counts — `|MERGING`, `|REBASE 2/7`, `|REBASE-i 2/7`, `|CHERRY-PICKING`, `|REVERTING`, `|AM`, `|BISECTING`. Read from `git rev-parse --git-path` marker paths, never from `git status` output, and live until the operation commits or aborts. While it is live the counts are suppressed, and the label is painted `warning` — or `error` while conflicts remain unresolved; it is the signal that survives after resolved conflicts are staged (`unmerged` back to 0).
_Avoid_: repo state, git state (gitstatus calls the concept "state")

**Editor frame**:
The rounded border wrapped around the input editor — `╭─ … ─╮` top rule, `│` rails with one column of inner padding, `╰─ … ─╯` bottom rule — always in box-drawing glyphs, never `+ - |`, with the body rendered at `width - 4` so wrapping and the caret belong to the body, not the frame (ADR-0004). The top rule carries the model field then the context field, and run activity when the row above is absent; the bottom rule carries turn telemetry (and `bottomLeftText`, when set) right-aligned. The usage/status row above the frame is not part of it and must stay byte-identical. Below 30 columns the frame is not drawn at all and pi's own rows pass through.
_Avoid_: editor border, box, outline

**Working indicator**:
pi's live run indicator (`⠋ Working`) rendered at the leftmost of the usage group on the stats line via the editor's `embedWorkingStatus` protocol, so pi never adds its own component above the editor. Carries no elapsed time — duration belongs to the run-activity section. When the run settles the slot does not empty: it switches to `● Ready` (atelier's idle counterpart), so the status never vanishes or moves; a fresh session grows no row just to say it is idle, and a non-working indicator (retry) leaves the slot empty rather than claiming Ready.
_Avoid_: spinner, loader, progress bar

**Field**:
A group of related chrome values, separated from other groups by `|`; its own values are joined by `·`. The glyph choice is semantics, not decoration (ADR-0004). Not the same thing as a footer **segment**, which is a user-toggleable slice of the footer.
_Avoid_: segment, group, block
