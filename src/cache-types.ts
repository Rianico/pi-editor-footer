// Output types for the /cache feature metrics and totals. The pi session-entry
// SHAPE these are computed from lives in src/session-entries.ts (the single
// seam); metric/totals shapes are defined locally — never imported from
// @earendil-works/pi-ai or pi-coding-agent, which are runtime-provided peers
// only (see src/index.ts header).

export interface CacheUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  assistantMessages: number;
}

export interface AssistantUsageMetric {
  sequence: number;
  activeBranchSequence?: number;
  entryId: string;
  timestamp: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cacheHitPercent: number;
  isOnActiveBranch: boolean;
}

export interface CacheSessionMetrics {
  allMessages: AssistantUsageMetric[];
  activeBranchMessages: AssistantUsageMetric[];
  treeTotals: CacheUsageTotals;
  activeBranchTotals: CacheUsageTotals;
}

/** Minimal slice of the pi theme the cache dialogs use. */
export interface CacheTheme {
  fg(style: string, text: string): string;
  bold(text: string): string;
}
