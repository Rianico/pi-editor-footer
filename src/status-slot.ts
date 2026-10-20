/**
 * Status slot on the usage row above the editor's top rule (ADR-0004 rev 2).
 *
 * The slot is a state, not a decoration: while an agent run is live the working
 * indicator owns it (`⠋ Working`, pi's spinner + pi's own message); once the run
 * settles the slot keeps its place and switches to `● Ready`, so the status never
 * vanishes and never moves to a second line.
 *
 * Two rules make that safe:
 *
 * - A **non-working** indicator (retry, compaction) also occupies the slot's
 *   place in the layout, but renders as its own row above the chrome — pi has no
 *   fallback once the editor claims `embedWorkingStatus`, so the slot must stay
 *   empty rather than claim "Ready" while a retry is running.
 * - `Ready` only renders when the usage row already exists (tokens or run
 *   activity). A fresh session does not grow an extra line just to say it is
 *   idle; the row appears with the first run and keeps the status afterwards.
 */
export type StatusSlot = "working" | "ready" | "none";

export interface StatusSlotInput {
  /** pi handed the editor an indicator (any kind). */
  hasIndicator: boolean;
  /** …and that indicator is the working one rather than retry/compaction/… */
  indicatorIsWorking: boolean;
  /** The usage row would exist anyway (tokens or run activity present). */
  hasUsageRow: boolean;
}

export function planStatusSlot({ hasIndicator, indicatorIsWorking, hasUsageRow }: StatusSlotInput): StatusSlot {
  if (hasIndicator) return indicatorIsWorking ? "working" : "none";
  return hasUsageRow ? "ready" : "none";
}
