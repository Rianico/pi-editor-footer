export type ThemeColor = string;
export type ThinkingLevel = string;

export function stressColor(value: number, warn = 70, danger = 90): ThemeColor {
  if (value >= danger) return "error";
  if (value >= warn) return "warning";
  return "accent";
}

export function contextUsageColor(pct: number): ThemeColor {
  // 12.5 / 25 / 50 quotas — four urgency tiers, increasingly aggressive as context fills.
  // 0 – 12.5%  dim      — plenty of headroom, visually quiet.
  // 12.5 – 25% accent   — first nudge, noticeable but calm.
  // 25 – 50%   warning  — half consumed, needs attention.
  // 50 – 100%  error     — critical, about to run out.
  // Uses theme semantic tokens (dim/accent/warning/error) so the progression
  // respects the active theme and remains legible on light/dark/custom palettes.
  // A fixed hex palette (e.g. grey→sky→amber→red) would be more vivid but
  // would ignore the user's theme and can clash with light backgrounds —
  // semantic tokens keep the "aggressive" ordering while staying theme-coherent.
  if (pct >= 50) return "error";
  if (pct >= 25) return "warning";
  if (pct >= 12.5) return "accent";
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
