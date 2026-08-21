export type ThemeColor = string;
export type ThinkingLevel = string;

export function stressColor(value: number, warn = 70, danger = 90): ThemeColor {
  if (value >= danger) return "error";
  if (value >= warn) return "warning";
  return "accent";
}

export function contextUsageColor(pct: number): ThemeColor {
  // 25% 50% 75% thresholds — transit from dimmed (low) to highlight (high)
  // for intuitive quota status: dim (<25) → accent (25-50) → warning (50-75) → error (≥75)
  if (pct >= 75) return "error";
  if (pct >= 50) return "warning";
  if (pct >= 25) return "accent";
  return "dim";
}

export function cacheHitColor(value: number): ThemeColor {
  if (value < 30) return "error";
  if (value < 70) return "warning";
  return "success";
}

export function providerColor(provider: string): ThemeColor {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "accent";
    case "openai":
    case "openai-codex":
      return "success";
    case "google":
    case "google-vertex":
      return "warning";
    case "amazon-bedrock":
      return "thinkingHigh";
    case "github-copilot":
      return "mdLink";
    case "deepseek":
      return "thinkingLow";
    case "xai":
    case "groq":
      return "error";
    default:
      return "muted";
  }
}

export function effortColor(
  level: ThinkingLevel | string | undefined,
): ThemeColor {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    default:
      return "thinkingMedium";
  }
}
