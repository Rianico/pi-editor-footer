// Barrel — preserves the old import surface while the codebase migrates to
// focused modules. New code should import from the owning module directly:
//   path-format → formatCwd, basenamePath, truncateBranch, truncatePath
//   color-policy → stressColor, cacheHitColor, providerColor, effortColor
//   format → fmtTokens, formatDuration, formatModelLabel, formatProviderLabel, formatThinkingLabel, sanitizeStatus, stripAnsi
//   layout → alignRight, fitSegmentsByPriority, isEditorBorderLine, findBottomBorderIndex, padRight, center, headerColumnWidths + width constants
//   tip-policy → PI_BUILTIN_SLASH_COMMAND_NAMES, collectPiCommandNames, pickSlashCommandTips

export { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type { ThemeColor, ThinkingLevel } from "./color-policy.js";
export type { Theme, PrioritizedSegment } from "./layout.js";

export { formatCwd, basenamePath, truncateBranch, truncatePath } from "./path-format.js";
export { fmtTokens, formatDuration, formatModelLabel, formatProviderLabel, formatThinkingLabel, sanitizeStatus, stripAnsi } from "./format.js";
export { stressColor, cacheHitColor, providerColor, effortColor } from "./color-policy.js";
export { alignRight, fitSegmentsByPriority, isEditorBorderLine, findBottomBorderIndex, padRight, center, headerColumnWidths, MIN_LEFT_WIDTH, MIN_TIPS_WIDTH, MAX_TIPS_WIDTH } from "./layout.js";
export { PI_BUILTIN_SLASH_COMMAND_NAMES, collectPiCommandNames, pickSlashCommandTips } from "./tip-policy.js";
