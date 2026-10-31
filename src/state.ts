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
import { lastSubagentUsageRecords, type SubagentUsageRecord } from "./subagent-usage.js";

export interface FooterState {
  git: GitStatus;
  /** In-progress git operation label ("MERGING", "REBASE 2/7"); empty when none runs. */
  gitAction: string;
  runtime: RuntimeInfo | null;
  sessionStartEpoch: number;
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

/** Everything a caller may ask the session totals to include or leave out. */
export interface UsageTotalsOptions {
  /**
   * Fold delegated-child usage (the `subagentUsage` toggle). Defaults to on — the
   * feature's own default — and a caller that owns the config passes it explicitly,
   * so "off" is a decision, never an omission.
   */
  includeSubagentUsage?: boolean;
}

export function getUsageTotals(
  ctx: UsageTotalsSource,
  options: UsageTotalsOptions = {},
): UsageTotals {
  const includeSubagentUsage = options.includeSubagentUsage !== false;
  const key = `${entriesKey(ctx)}:${includeSubagentUsage ? "subagents" : "parent"}`;
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
  /** Parent tool calls whose aggregate usage pi already put on their result entry. */
  const countedToolCalls = new Set<string>();
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
      if (entry.message.usage) {
        addUsage(entry.message.usage);
        const toolCallId = entry.message.toolCallId;
        if (toolCallId) countedToolCalls.add(toolCallId);
      }
      continue;
    }
    if (isSummaryEntry(entry)) {
      if (entry.usage) addUsage(entry.usage);
    }
  }

  if (includeSubagentUsage) {
    // Delegated children run in their own sessions, so their usage reaches us only
    // through the subagent-usage entries this extension appends. Only the LAST entry
    // counts (each stores the cumulative record list), and a record whose parent call
    // pi already billed on its toolResult entry is dropped — one child, one channel.
    for (const record of lastSubagentUsageRecords(ctx.sessionManager?.getEntries())) {
      if (record.toolCallId && countedToolCalls.has(record.toolCallId)) continue;
      addSubagentRecord(totals, record);
    }
  }

  usageCache = { key, totals };
  return totals;
}

/** Add one delegated child's usage — cache split included, hit rate untouched. */
function addSubagentRecord(totals: UsageTotals, record: SubagentUsageRecord): void {
  totals.input += record.input;
  totals.output += record.output;
  totals.cacheRead += record.cacheRead;
  totals.cacheWrite += record.cacheWrite;
  totals.cost += record.cost;
}

export function invalidateUsageCache(): void {
  usageCache = undefined;
}

export function createInitialState(): FooterState {
  return {
    git: emptyGitStatus(),
    gitAction: "",
    runtime: null,
    sessionStartEpoch: Date.now(),
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
