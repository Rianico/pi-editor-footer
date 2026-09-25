/**
 * Model-info border glow + label.
 *
 * Ported from the user's `model-info-widget` extension (~/.pi/agent/extensions/
 * model-info-widget/index.ts, MIT-style personal extension) so that the
 * TrackingEditor — which owns the editor slot for this extension — can keep
 * rendering the model label and thinking-level border glow that the original
 * widget provided. Self-contained apart from the shared label rendering here.
 *
 * The port is intentional: pi allows exactly ONE custom editor (last
 * `setEditorComponent` writer wins). pi-skill-desc must own the slot to track
 * the completion popup, so model-info-widget's editor install becomes inert and
 * its visual behavior lives here instead. See docs/adr/0001.
 *
 * C3: this module is the single home of the thinking-glow seam (ADR-0002) —
 * `resolveThinkingGlow` validates the optional pi theme extension once so
 * border-renderer no longer duplicates the cast inline. The old private
 * `buildGlow`/`applyModelInfo` chain was dead (border-renderer embeds labels
 * itself) and was pruned with it.
 */

/** Structural subset of pi's Theme used by the glow/label rendering. */
export interface ThemeLike {
  getFgAnsi(color: string): string;
  getColorMode(): string;
  getThinkingBorderColor(level: string): (s: string) => string;
  fg(style: string, s: string): string;
  bold(s: string): string;
  dim(s: string): string;
  muted(s: string): string;
}

/** The model/thinking info the border label shows. */
export interface ModelInfo {
  provider: string;
  modelId: string;
  level: string;
  contextWindow: number;
}

/**
 * Read the optional `getThinkingBorderColor` pi theme extension into a
 * `(level, s) => s` glow. Returns `undefined` when the theme has no glow —
 * callers keep their own identity fallback explicit at the call site. A theme
 * whose glow throws at call time degrades to identity for that string.
 */
export function resolveThinkingGlow(
  rawTheme: unknown,
): ((level: string, s: string) => string) | undefined {
  const t = rawTheme as {
    // SAFETY: pi theme seam — getThinkingBorderColor is optional theme extension
    getThinkingBorderColor?: (level: string) => (s: string) => string;
  };
  if (typeof t.getThinkingBorderColor !== "function") return undefined;
  return (level: string, s: string) => {
    try {
      return t.getThinkingBorderColor!(level)(s);
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
      return s;
    }
  };
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

export function buildLabel(
  theme: ThemeLike,
  provider: string,
  modelId: string,
  level: string,
  _contextWindow: number,
): string {
  const providerPart = provider === "" ? "" : theme.fg("dim", `${provider}/`);
  const modelPart = theme.fg("accent", theme.bold(modelId === "" ? "unknown" : modelId));
  const levelPart = theme.getThinkingBorderColor(level)(level);
  return `${providerPart}${modelPart}${theme.fg("dim", " · ")}${levelPart}`;
}
