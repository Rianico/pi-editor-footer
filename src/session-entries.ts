// The single home for the pi SESSION-ENTRY shape — the runtime seam this
// extension reads session history through. Pi entries satisfy these types
// structurally at runtime and are CAST, never validated field-by-field
// (same posture as the rest of the pi seams in this codebase).
//
// Before this module, the same entry shape was described twice with divergent
// strictness (`state.ts` permissive, `cache-types.ts` required), so a pi update
// that renamed `branch_summary` or moved `usage` could break one reader while
// the other's types still compiled. Both readers now share these types and the
// classifier predicates below.

/** Raw provider usage block as persisted on a session entry (permissive union). */
export interface SessionUsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

/** Message slice of a session entry. */
export interface SessionMessageLike {
  role: string;
  provider?: string;
  model?: string;
  usage?: SessionUsageLike;
}

/**
 * One pi session entry. `usage` sits at the top level on branch_summary /
 * compaction entries and inside `message` on message entries, so both positions
 * are declared optional here.
 */
export interface SessionEntryLike {
  type: string;
  id?: string;
  timestamp?: string;
  message?: SessionMessageLike;
  usage?: SessionUsageLike;
}

/** A message entry whose assistant usage is present. */
export type AssistantUsageEntry = SessionEntryLike & {
  message: SessionMessageLike & { usage: SessionUsageLike };
};

/** Minimal read seam for session history (entries only). */
export interface SessionEntryReader {
  getEntries(): SessionEntryLike[];
}

/** Read seam for callers that also need the active-branch view. */
export interface BranchAwareSessionEntryReader extends SessionEntryReader {
  getBranch(): SessionEntryLike[];
}

/** Assistant turn with a usage block — the source of per-message cache metrics. */
export function isAssistantUsageEntry(entry: SessionEntryLike): entry is AssistantUsageEntry {
  return (
    entry.type === "message" &&
    entry.message?.role === "assistant" &&
    entry.message.usage !== undefined
  );
}

/** Tool-result message (usage, when present, is a nested model call). */
export function isToolResultEntry(entry: SessionEntryLike): boolean {
  return entry.type === "message" && entry.message?.role === "toolResult";
}

/** branch_summary / compaction entry (top-level usage, when present, is a nested model call). */
export function isSummaryEntry(entry: SessionEntryLike): boolean {
  return entry.type === "branch_summary" || entry.type === "compaction";
}

/**
 * Normalize a permissive usage block to fully-populated numbers (missing
 * fields default to 0). This is where "required numbers" strictness lives —
 * at the seam, not in the entry type.
 */
export function usageNumbers(usage: SessionUsageLike): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
} {
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  };
}
