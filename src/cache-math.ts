import type { AssistantUsageMetric, CacheUsageTotals } from "./cache-types.js";

/**
 * Canonical prompt-total denominator: input + cacheRead + cacheWrite.
 *
 * Anthropic-style: input excludes newly-cached tokens, which arrive in
 * cacheWrite — so both must be included.
 * OpenAI-style: cacheWrite is 0, so this is backwards-compatible.
 *
 * This module is the single owner of the formula; every other site
 * (`state.ts:totalInputTokens`, cache-format/export/stats-view) delegates here.
 */
export function promptTokens(input: number, cacheRead: number, cacheWrite: number): number {
  return input + cacheRead + cacheWrite;
}

/**
 * Canonical cache-hit % formula: cacheRead / promptTokens * 100.
 *
 * Edge semantics: returns 0 when the denominator is not positive. Callers
 * that distinguish "no cache seen yet" from "0% hit" gate on
 * `promptTokens(...) > 0` themselves (see `state.ts:getUsageTotals`).
 */
export function computeCacheHitPercent(
  input: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const denominator = promptTokens(input, cacheRead, cacheWrite);
  if (denominator <= 0) return 0;
  return (cacheRead / denominator) * 100;
}

export function emptyTotals(): CacheUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    assistantMessages: 0,
  };
}

export function addToTotals(totals: CacheUsageTotals, message: AssistantUsageMetric): void {
  totals.input += message.input;
  totals.output += message.output;
  totals.cacheRead += message.cacheRead;
  totals.cacheWrite += message.cacheWrite;
  totals.totalTokens += message.totalTokens;
  totals.assistantMessages += 1;
}
