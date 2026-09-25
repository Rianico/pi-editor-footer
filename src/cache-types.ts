// Structural types for the /cache feature. Defined locally — never imported
// from @earendil-works/pi-ai or pi-coding-agent, which are runtime-provided
// peers only (see src/index.ts header). The pi session entries satisfy
// CacheSessionEntryLike structurally at runtime.

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

export interface CacheUsageLike {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface CacheSessionEntryLike {
  type: string;
  id: string;
  timestamp: string;
  message?: {
    role: string;
    provider?: string;
    model?: string;
    usage?: CacheUsageLike;
  };
}

export interface CacheSessionReader {
  getEntries(): CacheSessionEntryLike[];
  getBranch(): CacheSessionEntryLike[];
}

/** Minimal slice of the pi theme the cache dialogs use. */
export interface CacheTheme {
  fg(style: string, text: string): string;
  bold(text: string): string;
}
