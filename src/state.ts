import type { GitStatus } from "./git.js";
import { emptyGitStatus } from "./git.js";
import type { RuntimeInfo } from "./runtime.js";
import { fmtTokens } from "./format.js";
import { formatProviderLabel } from "./format.js";

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

/** Raw provider usage block as persisted on a session entry. */
export interface EntryUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

/**
 * Session entry slice read by getUsageTotals — the pi seam, validated at runtime.
 * `usage` sits at the top level on branch_summary / compaction entries and inside
 * `message` on message entries.
 */
export interface UsageSessionEntry {
  type: string;
  id?: string;
  timestamp?: string;
  message?: { role: string; usage?: EntryUsage };
  usage?: EntryUsage;
}

/** Minimal session-manager seam getUsageTotals reads entries through. */
export interface UsageTotalsSource {
  sessionManager?: { getEntries(): UsageSessionEntry[] };
}

/**
 * Total input tokens billed to the model: uncached input + cache read + cache write.
 *
 * pi-ai `Usage.input` excludes the cached prompt prefix (it lives in cacheRead/cacheWrite),
 * so `input` alone under-reports the prompt by the whole cached history on every turn.
 */
export function totalInputTokens(
  totals: Pick<UsageTotals, "input" | "cacheRead" | "cacheWrite">,
): number {
  return totals.input + totals.cacheRead + totals.cacheWrite;
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
  const addUsage = (usage: EntryUsage): void => {
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
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const usage = entry.message.usage;
      if (!usage) continue;
      addUsage(usage);
      const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      if (promptTokens > 0) {
        totals.latestCacheHitRate = ((usage.cacheRead ?? 0) / promptTokens) * 100;
      }
      continue;
    }
    if (entry.type === "message" && entry.message?.role === "toolResult") {
      if (entry.message.usage) addUsage(entry.message.usage);
      continue;
    }
    if (entry.type === "branch_summary" || entry.type === "compaction") {
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

// Keep fmtTokens usage to satisfy import, used by getUsageTotals display elsewhere
void fmtTokens;
