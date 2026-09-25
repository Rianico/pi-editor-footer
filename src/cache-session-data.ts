import { addToTotals, computeCacheHitPercent, emptyTotals } from "./cache-math.js";
import type {
  AssistantUsageMetric,
  CacheSessionEntryLike,
  CacheSessionMetrics,
  CacheSessionReader,
} from "./cache-types.js";

function isAssistantUsageEntry(entry: CacheSessionEntryLike): boolean {
  return (
    entry.type === "message" &&
    entry.message?.role === "assistant" &&
    entry.message.usage !== undefined
  );
}

export function collectCacheSessionMetrics(
  sessionManager: CacheSessionReader,
): CacheSessionMetrics {
  const allEntries = sessionManager.getEntries();
  const activeBranchIds = new Set(sessionManager.getBranch().map((entry) => entry.id));

  const treeTotals = emptyTotals();
  const activeBranchTotals = emptyTotals();
  const allMessages: AssistantUsageMetric[] = [];
  const activeBranchMessages: AssistantUsageMetric[] = [];

  let sequence = 0;
  let activeBranchSequence = 0;

  for (const entry of allEntries) {
    if (!isAssistantUsageEntry(entry)) continue;
    const message = entry.message!;
    const usage = message.usage!;

    sequence += 1;

    const metric: AssistantUsageMetric = {
      sequence,
      activeBranchSequence: undefined,
      entryId: entry.id,
      timestamp: entry.timestamp,
      provider: message.provider ?? "",
      model: message.model ?? "",
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      totalTokens: usage.totalTokens,
      cacheHitPercent: computeCacheHitPercent(usage.input, usage.cacheRead, usage.cacheWrite),
      isOnActiveBranch: activeBranchIds.has(entry.id),
    };

    addToTotals(treeTotals, metric);
    allMessages.push(metric);

    if (metric.isOnActiveBranch) {
      activeBranchSequence += 1;
      metric.activeBranchSequence = activeBranchSequence;
      addToTotals(activeBranchTotals, metric);
      activeBranchMessages.push(metric);
    }
  }

  return {
    allMessages,
    activeBranchMessages,
    treeTotals,
    activeBranchTotals,
  };
}
