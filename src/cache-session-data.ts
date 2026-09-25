import { addToTotals, computeCacheHitPercent, emptyTotals } from "./cache-math.js";
import type { AssistantUsageMetric, CacheSessionMetrics } from "./cache-types.js";
import {
  isAssistantUsageEntry,
  usageNumbers,
  type BranchAwareSessionEntryReader,
} from "./session-entries.js";

export function collectCacheSessionMetrics(
  sessionManager: BranchAwareSessionEntryReader,
): CacheSessionMetrics {
  const allEntries = sessionManager.getEntries();
  const activeBranchIds = new Set(sessionManager.getBranch().map((entry) => entry.id ?? ""));

  const treeTotals = emptyTotals();
  const activeBranchTotals = emptyTotals();
  const allMessages: AssistantUsageMetric[] = [];
  const activeBranchMessages: AssistantUsageMetric[] = [];

  let sequence = 0;
  let activeBranchSequence = 0;

  for (const entry of allEntries) {
    if (!isAssistantUsageEntry(entry)) continue;
    const entryId = entry.id ?? "";
    const usage = usageNumbers(entry.message.usage);

    sequence += 1;

    const metric: AssistantUsageMetric = {
      sequence,
      activeBranchSequence: undefined,
      entryId,
      timestamp: entry.timestamp ?? "",
      provider: entry.message.provider ?? "",
      model: entry.message.model ?? "",
      ...usage,
      cacheHitPercent: computeCacheHitPercent(usage.input, usage.cacheRead, usage.cacheWrite),
      isOnActiveBranch: activeBranchIds.has(entryId),
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
