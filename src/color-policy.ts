export type ThemeColor = string;
export type ThinkingLevel = string;

export function stressColor(value: number, warn = 70, danger = 90): ThemeColor {
  if (value >= danger) return "error";
  if (value >= warn) return "warning";
  return "accent";
}

/** Context-pressure tier: green → amber → red as the window fills. */
export type ContextTier = "ok" | "warn" | "critical";

/**
 * Fixed tier palette (nord green / nord yellow / dark red). Hex, not theme tokens:
 * the tiers are an alarm scale the user picked explicitly, so they must read the
 * same on every theme. `CONTEXT_TIER_THEME_COLOR` is only the fallback for themes
 * that cannot emit raw hex.
 */
export const CONTEXT_TIER_HEX: Record<ContextTier, string> = {
  ok: "#A3BE8C",
  warn: "#EBCB8B",
  critical: "#9A3939",
};

/** Semantic token approximating each tier — used when raw hex is unavailable. */
export const CONTEXT_TIER_THEME_COLOR: Record<ContextTier, ThemeColor> = {
  ok: "success",
  warn: "warning",
  critical: "error",
};

/**
 * Tier from the share of the context window consumed.
 *
 * Budgets scale with the window: a 1M window only earns 12.5 / 25 % of slack
 * before the same alarm, while smaller windows (compacted far sooner) keep the
 * looser 25 / 50 % steps.
 */
export function contextUsageTier(pct: number, contextWindow: number): ContextTier {
  const [warnAt, criticalAt] = contextWindow >= 1_000_000 ? [12.5, 25] : [25, 50];
  if (pct >= criticalAt) return "critical";
  if (pct >= warnAt) return "warn";
  return "ok";
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

export function effortColor(level: ThinkingLevel | string | undefined): ThemeColor {
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
