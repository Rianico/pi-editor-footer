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

/**
 * Chart glyphs for the graph views, resolved from the repo's icon mode.
 * The reference hardcoded the unicode set; ascii mode swaps in
 * single-byte fallbacks the same way footer's renderBar does.
 */
export interface ChartGlyphs {
  /** filled cell in the 0–100% bar charts */
  full: string;
  /** unlit cell */
  empty: string;
  /** x-axis line */
  axis: string;
  /** stacked-chart series */
  input: string;
  cacheWrite: string;
  cacheRead: string;
}

export const UNICODE_CHART_GLYPHS: ChartGlyphs = {
  full: "█",
  empty: "·",
  axis: "─",
  input: "▇",
  cacheWrite: "░",
  cacheRead: "▒",
};

export const ASCII_CHART_GLYPHS: ChartGlyphs = {
  full: "#",
  empty: ".",
  axis: "-",
  input: "=",
  cacheWrite: "+",
  cacheRead: "%",
};

/** Minimal slice of the pi theme the cache dialogs use. */
export interface CacheTheme {
  fg(style: string, text: string): string;
  bold(text: string): string;
}
