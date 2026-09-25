import {
  formatInt,
  formatPercent,
  formatTotalsLine,
  promptTokens,
  shortModelName,
  summarizeHitPercent,
} from "./cache-format.js";
import type { AssistantUsageMetric, CacheSessionMetrics, CacheTheme } from "./cache-types.js";
import { padLeft, padRight, visibleWidth } from "./layout.js";

function buildRow(
  metric: AssistantUsageMetric,
  includeEntryId: boolean,
  includeTimestamp: boolean,
): string {
  const cols = [
    padLeft(String(metric.sequence), 4),
    padRight(metric.isOnActiveBranch ? "*" : " ", 1),
    padRight(shortModelName(metric.provider, metric.model), 24, "…"),
    padLeft(formatInt(promptTokens(metric)), 9),
    padLeft(formatInt(metric.output), 9),
    padLeft(formatInt(metric.cacheRead), 9),
    padLeft(formatInt(metric.cacheWrite), 9),
    padLeft(formatPercent(metric.cacheHitPercent), 7),
  ];

  if (includeEntryId) cols.splice(2, 0, padRight(metric.entryId, 8));
  if (includeTimestamp)
    cols.splice(includeEntryId ? 3 : 2, 0, padRight(metric.timestamp.slice(11, 19), 8));

  return cols.join(" ");
}

function buildHeader(includeEntryId: boolean, includeTimestamp: boolean): string {
  const cols = [
    padLeft("#", 4),
    padRight("B", 1),
    padRight("model", 24),
    padLeft("prompt", 9),
    padLeft("recv", 9),
    padLeft("hit", 9),
    padLeft("write", 9),
    padLeft("hit%", 7),
  ];

  if (includeEntryId) cols.splice(2, 0, padRight("entry", 8));
  if (includeTimestamp) cols.splice(includeEntryId ? 3 : 2, 0, padRight("time", 8));

  return cols.join(" ");
}

function buildCumulativeSummary(theme: CacheTheme, metrics: CacheSessionMetrics): string[] {
  const treeHitRate = summarizeHitPercent(metrics.treeTotals);
  const branchHitRate = summarizeHitPercent(metrics.activeBranchTotals);

  return [
    theme.fg("accent", theme.bold("Cumulative totals")),
    formatTotalsLine("Active branch", metrics.activeBranchTotals),
    formatTotalsLine("Whole tree", metrics.treeTotals),
    `Delta (tree - branch): prompt ${formatInt(promptTokens(metrics.treeTotals) - promptTokens(metrics.activeBranchTotals))} • ` +
      `received ${formatInt(metrics.treeTotals.output - metrics.activeBranchTotals.output)} • ` +
      `cache hit ${formatInt(metrics.treeTotals.cacheRead - metrics.activeBranchTotals.cacheRead)} • ` +
      `cache write ${formatInt(metrics.treeTotals.cacheWrite - metrics.activeBranchTotals.cacheWrite)} • ` +
      `hit-rate spread ${formatPercent(treeHitRate - branchHitRate)}`,
  ];
}

export function renderStatsBody(
  theme: CacheTheme,
  metrics: CacheSessionMetrics,
  width: number,
): string[] {
  const lines: string[] = [];

  lines.push(theme.fg("accent", theme.bold("Token/cache stats by assistant message")));
  lines.push(theme.fg("dim", "B = message is on the current active branch"));
  lines.push("");
  lines.push(...buildCumulativeSummary(theme, metrics));
  lines.push("");

  if (metrics.allMessages.length === 0) {
    lines.push(
      theme.fg(
        "warning",
        "No assistant messages with usage data are available yet in this session.",
      ),
    );
    return lines;
  }

  const includeEntryId = width >= 92;
  const includeTimestamp = width >= 104;
  const header = buildHeader(includeEntryId, includeTimestamp);

  lines.push(theme.fg("accent", theme.bold("Per-message breakdown")));
  lines.push(theme.fg("muted", header));
  lines.push(theme.fg("dim", "-".repeat(Math.min(visibleWidth(header), Math.max(20, width - 2)))));

  for (const metric of metrics.allMessages) {
    lines.push(buildRow(metric, includeEntryId, includeTimestamp));
  }

  return lines;
}
