import { computeCacheHitPercent, promptTokens as promptTokensOf } from "./cache-math.js";
import type { CacheUsageTotals } from "./cache-types.js";

// formatInt keeps thousands separators: the stats table aligns columns on
// full-width numbers, so fmtTokens (k/M compaction) does not fit here.
export function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function shortModelName(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function summarizeHitPercent(
  totals: Pick<CacheUsageTotals, "input" | "cacheRead" | "cacheWrite">,
): number {
  return computeCacheHitPercent(totals.input, totals.cacheRead, totals.cacheWrite);
}

/** Object-shaped delegate — the formula lives in `cache-math.ts:promptTokens`. */
export function promptTokens(
  totals: Pick<CacheUsageTotals, "input" | "cacheRead" | "cacheWrite">,
): number {
  return promptTokensOf(totals.input, totals.cacheRead, totals.cacheWrite);
}

export function formatTotalsLine(label: string, totals: CacheUsageTotals): string {
  return [
    `${label}:`,
    `${formatInt(totals.assistantMessages)} turns`,
    `prompt ${formatInt(promptTokens(totals))}`,
    `received ${formatInt(totals.output)}`,
    `cache hit ${formatInt(totals.cacheRead)}`,
    `cache write ${formatInt(totals.cacheWrite)}`,
    `hit rate ${formatPercent(summarizeHitPercent(totals))}`,
  ].join(" • ");
}
