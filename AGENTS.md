## Agent skills

### Issue tracker

Issues and specs live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Pi editor replacement — sync contract

This extension **replaces pi's default input editor**: `TrackingEditor` (`src/tracking-editor.ts`) is the actual editor in the input box. It replicates pi's `CustomEditor` inline and observes the completion popup through two private pi-tui internals (`autocompleteList`, `applyAutocompleteSuggestions`).

**Pi editor features are NOT inherited — on every pi update, or whenever pi changes or extends editor behaviour (keybindings, IME, autocomplete, border rendering), diff pi's `CustomEditor` and `Editor` against `src/tracking-editor.ts` and port the changes over.** The exact sources to diff, the internals to watch, and the pty verification loop are in `docs/reference/pi-tui-internals.md` ("Sync contract" section). Why the editor is replaced at all: ADR-0001 and ADR-0002.
