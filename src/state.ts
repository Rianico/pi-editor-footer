import type { GitStatus } from "./git.js";
import { emptyGitStatus } from "./git.js";
import type { RuntimeInfo } from "./runtime.js";
import { formatProviderLabel } from "./format.js";
import { computeCacheHitPercent, promptTokens } from "./cache-math.js";
import {
  isAssistantUsageEntry,
  isSummaryEntry,
  isToolResultEntry,
  usageNumbers,
  type SessionEntryReader,
  type SessionUsageLike,
} from "./session-entries.js";

export interface FooterState {
  git: GitStatus;
  runtime: RuntimeInfo | null;
  sessionStartEpoch: number;
  workingSince: number | undefined;
  lastDoneIn: number | undefined;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate: number | undefined;
}

/** Minimal session-manager seam getUsageTotals reads entries through. */
export interface UsageTotalsSource {
  sessionManager?: SessionEntryReader;
}

/**
 * Total input tokens billed to the model: uncached input + cache read + cache write.
 *
 * pi-ai `Usage.input` excludes the cached prompt prefix (it lives in cacheRead/cacheWrite),
 * so `input` alone under-reports the prompt by the whole cached history on every turn.
 * The denominator itself is owned by `cache-math.ts:promptTokens`.
 */
export function totalInputTokens(
  totals: Pick<UsageTotals, "input" | "cacheRead" | "cacheWrite">,
): number {
  return promptTokens(totals.input, totals.cacheRead, totals.cacheWrite);
}

let usageCache: { key: string; totals: UsageTotals } | undefined;

function entriesKey(ctx: UsageTotalsSource): string {
  const entries = ctx.sessionManager?.getEntries() ?? [];
  const last = entries.at(-1);
  return `${entries.length}:${String(last?.id ?? "")}:${String(last?.timestamp ?? "")}`;
}

export function getUsageTotals(ctx: UsageTotalsSource): UsageTotals {
  const key = entriesKey(ctx);
  if (usageCache && usageCache.key === key) return usageCache.totals;

  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    latestCacheHitRate: undefined,
  };
  const addUsage = (usage: SessionUsageLike): void => {
    totals.input += usage.input ?? 0;
    totals.output += usage.output ?? 0;
    totals.cacheRead += usage.cacheRead ?? 0;
    totals.cacheWrite += usage.cacheWrite ?? 0;
    totals.cost += usage.cost?.total ?? 0;
  };
  for (const entry of ctx.sessionManager?.getEntries() ?? []) {
    // Assistant turns carry the cache split the hit rate is derived from; tool results
    // and summaries are usage from nested model calls — billed, so they count toward the
    // session totals (parity with pi core's addUsageToTotals loop).
    if (isAssistantUsageEntry(entry)) {
      const usage = entry.message.usage;
      addUsage(usage);
      const { input, cacheRead, cacheWrite } = usageNumbers(usage);
      // `undefined` means "no assistant turn with a real prompt yet" — distinct
      // from a genuine 0% hit, which the owner returns for prompt totals > 0.
      if (promptTokens(input, cacheRead, cacheWrite) > 0) {
        totals.latestCacheHitRate = computeCacheHitPercent(input, cacheRead, cacheWrite);
      }
      continue;
    }
    if (isToolResultEntry(entry)) {
      if (entry.message?.usage) addUsage(entry.message.usage);
      continue;
    }
    if (isSummaryEntry(entry)) {
      if (entry.usage) addUsage(entry.usage);
    }
  }
  usageCache = { key, totals };
  return totals;
}

export function invalidateUsageCache(): void {
  usageCache = undefined;
}

export function createInitialState(): FooterState {
  return {
    git: emptyGitStatus(),
    runtime: null,
    sessionStartEpoch: Date.now(),
    workingSince: undefined,
    lastDoneIn: undefined,
  };
}

export interface ModelMeta {
  provider: string;
  model: string;
  effort: string | undefined;
}

export function getModelMeta(
  ctx: {
    model?: {
      provider?: string;
      name?: string;
      id?: string;
      reasoning?: boolean;
    };
  },
  getThinkingLevel: () => string,
): ModelMeta {
  const provider = formatProviderLabel(ctx.model?.provider);
  const model = ctx.model?.name ?? ctx.model?.id ?? "no-model";
  const reasoning = ctx.model?.reasoning ?? false;
  const effort = reasoning ? getThinkingLevel() : undefined;
  return { provider, model, effort };
}
