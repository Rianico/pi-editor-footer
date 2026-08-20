import type { GitStatus } from "./git.js";
import { emptyGitStatus } from "./git.js";
import type { RuntimeInfo } from "./runtime.js";
import { fmtTokens, formatProviderLabel } from "./utils.js";

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

let usageCache: { key: string; totals: UsageTotals } | undefined;

function entriesKey(ctx: {
  sessionManager?: { getEntries(): unknown[] };
}): string {
  const entries = ctx.sessionManager?.getEntries() ?? [];
  const last = entries.at(-1) as
    | { id?: string; timestamp?: string }
    | undefined;
  return `${entries.length}:${String(last?.id ?? "")}:${String(last?.timestamp ?? "")}`;
}

export function getUsageTotals(ctx: {
  sessionManager?: {
    getEntries(): {
      type: string;
      message?: {
        role: string;
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          cost?: { total?: number };
        };
      };
    }[];
  };
}): UsageTotals {
  const key = entriesKey(
    ctx as unknown as { sessionManager?: { getEntries(): unknown[] } },
  );
  if (usageCache && usageCache.key === key) return usageCache.totals;

  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    latestCacheHitRate: undefined,
  };
  const entries =
    (
      ctx as unknown as {
        sessionManager?: {
          getEntries(): {
            type: string;
            message?: {
              role: string;
              usage?: {
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
                cost?: { total?: number };
              };
            };
          }[];
        };
      }
    ).sessionManager?.getEntries() ?? [];
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const u = entry.message.usage;
      if (!u) continue;
      totals.input += u.input ?? 0;
      totals.output += u.output ?? 0;
      totals.cacheRead += u.cacheRead ?? 0;
      totals.cacheWrite += u.cacheWrite ?? 0;
      totals.cost += u.cost?.total ?? 0;
      const promptTokens =
        (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      if (promptTokens > 0) {
        totals.latestCacheHitRate = ((u.cacheRead ?? 0) / promptTokens) * 100;
      }
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
