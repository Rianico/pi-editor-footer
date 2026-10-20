# Editor chrome: rounded frame, unified separators, Working on the stats line

The editor slot has grown three inconsistencies that only show when you look at the whole chrome rather than one segment: the input is fenced by two horizontal rules and nothing else, so it does not read as a frame; the provider half of the model label is dim while the model half is bold, which makes one identity look like two; and three separators (`·`, `|`, `•`) are used without a rule, so `cwd · git • runtime` mixes two of them inside one line. Separately, pi renders its `WorkingStatusIndicator` as a component **above** the editor even though this chrome already shows a working indicator, duplicating it and costing a line. We adopt pi-atelier's rounded frame for the editor, give the separators one rule (`|` between fields, `·` between sections inside a field), carry the provider into the model label's accent, and implement pi's `embedWorkingStatus` protocol so the indicator moves to the leftmost of the token/cost group on the stats line.

Status: accepted

## Considered Options

- **Framed editor, atelier geometry (`╭─ ─╮` + one column of inner padding, inner rendered at `width - 4`)** — chosen. Parity with the reference, and the padding is what keeps text off the rail. Costs four usable columns.
- **Tight rails (`width - 2`, no padding)** — cheaper in columns, but text touches the rail at every wrap and the frame reads as a table rather than a container.
- **Rounded corners only, no rails** — that is what we have today; it is a fence, not a frame, and was the thing being fixed.
- **ascii-mode frame in `+ - |`** — rejected on review: `icons.mode` exists for *glyph* fallbacks, and box-drawing is not in that class. The frame always uses `╭ ╮ ╰ ╯ │`, in both modes.
- **Swallow pi's `WorkingStatusIndicator`** (embed and render nothing) — rejected: it also hides a custom `setWorkingMessage` from another extension, and it silently deletes the `esc to interrupt` affordance.
- **Patch `InteractiveMode.showStatusIndicator`** to skip the status container — rejected: private internals for something pi exposes as an extension protocol.
- **Remove our own footer working indicator and keep pi's above-editor component** — rejected: it keeps the duplicated line above the input, which is the thing being removed.

## Consequences

- **Frame.** `TrackingEditor.render()` frames the editor: top rule `╭─ … ─╮`, body rows `│ <line> │` with one column of padding, bottom rule `╰─ … ─╯`; the editor body is rendered at `width - 4` (`EDITOR_FRAME_CHROME = 4`) and the frame is dropped below a 30-column width, where it would eat the input. **The telemetry status line that already sits above the top rule is preserved exactly as it is** — same line, same left alignment, same contents — and the frame is added *below* it; the frame must not swallow, duplicate, or move that line. The top rule keeps its existing contents (`provider/model · thinking | cache · usage` on the left, run activity on the right) and the bottom rule keeps the turn telemetry, right-aligned. The thinking-level glow now travels all four sides; a frame whose verticals were a different colour from its horizontals would read as a rendering artifact.
- **Provider.** `provider` leaves `dim` and joins the accent+bold run of the model id; the `/` between them stays dim. An empty provider still renders nothing at all, and an unknown model still falls back to `unknown`.
- **Working indicator.** `TrackingEditor` declares `embedWorkingStatus = true` and implements `setWorkingStatusIndicator()`, so pi stops adding its component above the editor. The indicator renders as `⠋ Working` (pi's spinner frame + pi's message) as the **leftmost section of the telemetry status line that already sits above the editor's top rule** — the left-aligned line carrying `↑ … · ↓ … · $…` and, after the `|`, the run activity:

  ```
   ⠋ Working · ↑ 14M · ↓ 89k · $0.15 | T1 · 8s · 2 tools
   ╭─ opencode-go/deepseek-v4.1-flash · high | c 98.1% · 14.6% · 146k/1.0M ──────────────╮
  ```

  No elapsed time is carried — the run-activity section already reports duration, and two clocks on two lines invite disagreement. The footer's own `working Ns` segment is deleted. Because that line is otherwise conditional on having tokens or activity to show, the working segment must be able to bring the line into existence on its own. **Every indicator kind is handed to the editor** — pi's `showStatusIndicator` has no kind filter (`interactive-mode.js:1776-1793`), so retry and compaction indicators are embedded too. Non-working kinds are therefore rendered by the editor as their own row above the chrome and never swallowed; `Working` is the only kind that joins the usage row. Verified live by forcing a provider error: `Retrying (1/3 … 3/3)` renders on its own row.

  **The slot is a state, not a decoration.** When the run settles the slot does not empty — it switches to `● Ready`, atelier's idle counterpart to `◆ Working` (`pi-atelier/src/sidebar.ts:164`), in the same place so the status never vanishes or moves to a second line:

  ```
   ● Ready · ↑ 89 · ↓ 10 | 1 turns · 4s · 0 tools
  ```

  Two limits keep that honest: `Ready` renders only where the usage row already exists, so a fresh session does not grow a line just to announce idleness; and a non-working indicator (retry, compaction) leaves the slot **empty** rather than claiming Ready — retrying is not ready.
- **The `esc to interrupt` hint is not carried over.** The indicator becomes one section of a status line; a keyboard affordance belongs in pi's own hint surface, and the embedding API drops that line anyway (`renderInBorder` returns the spinner/message line only).
- **Separators.** One rule: `|` between fields, `·` between sections inside a field. `•` is retired from the chrome entirely.
  - Top rule: `provider/model · thinking` (one field) `|` `c 98.1% · 14.6% · 146k/1.0M` (the context field, its three sections joined by `·` — cache is a section of context, not a field of its own).
  - Activity and telemetry keep `·` (one field each).
  - Stats line: `⠋ Working · ↑ 14M · ↓ 89k · $0.15` — one status/usage field.
  - Footer left: `cwd · git` is one field (where am I), `runtime` another: `@ repo · main [?1] | node 26.8.1`.
  - The optional tokens-above-top-rule line uses `·`, matching the stats line it duplicates.
- **Sync contract.** `embedWorkingStatus`, `setWorkingStatusIndicator` and the `render()` override join the pi-tui internals checklist: a pi bump can change the indicator protocol, the frame's interaction with cursor reporting, and the editor's own line count.
- **Verification must be a pty capture, not unit strings.** Rails shift every body column by two and the body is rendered at `width - 4`, so the caret, selection, mid-line edits, completion-popup alignment, wrapped long lines and the `↑ N more` scroll indicator all have to be observed in a real terminal.
