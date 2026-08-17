# pi-skill-desc

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
