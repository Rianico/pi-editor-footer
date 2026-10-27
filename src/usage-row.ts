/**
 * The usage row above the editor frame (ADR-0004 revision 3).
 *
 * Three fields, `|`-separated, each absent when empty:
 *
 *   `⠋ Working | ↑ 40k · ↓ 8k · 2 turns · 8s · 3 tools | !2×3.3s`
 *
 * - The **status slot** is the editor's, because pi's indicator is: `⠋ Working`
 *   while a run is live, `● Ready` once it settles, empty while a non-working
 *   indicator (retry, compaction) owns pi's slot — retrying is not ready.
 * - The **run field** joins delta tokens and run activity with `·`: two slices
 *   of one answer. Delta tokens lead, so the pair is the stable half and a
 *   volatile activity section (`3 tools` → `12 tools (2 running)`) grows to its
 *   right without shifting it.
 * - The **stall field** is a condition rather than an activity metric, so it is
 *   its own field and disappears entirely while the run is healthy.
 *
 * Joiners are derived from present fields only, so an empty slot can never
 * leave a leading or doubled pipe.
 */
export interface UsageRowFields {
  /** `⠋ Working` / `● Ready`; empty while a non-working indicator owns the slot. */
  status?: string;
  /** Delta tokens (`↑ … · ↓ …`), already styled. */
  tokens?: string;
  /** Run activity (`2 turns · 8s · 3 tools`), already styled. */
  activity?: string;
  /** Stall (`!2×3.3s`), already styled; absent while healthy. */
  stall?: string;
}

export interface UsageRowTheme {
  fg(style: string, text: string): string;
}

export function composeUsageRow(fields: UsageRowFields, theme: UsageRowTheme): string {
  const dimSection = theme.fg("dim", " · ");
  const dimField = theme.fg("dim", " | ");
  const runField = [fields.tokens, fields.activity].filter(Boolean).join(dimSection);
  return [fields.status, runField, fields.stall].filter(Boolean).join(dimField);
}
