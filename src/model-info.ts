/**
 * Model-info border glow + label.
 *
 * Ported from the user's `model-info-widget` extension (~/.pi/agent/extensions/
 * model-info-widget/index.ts, MIT-style personal extension) so that the
 * TrackingEditor — which owns the editor slot for this extension — can keep
 * rendering the model label and thinking-level border glow that the original
 * widget provided. Self-contained apart from pi-tui width utils, the shared
 * ANSI quantizer (ansi-color.ts) and stripAnsi (format.ts).
 *
 * The port is intentional: pi allows exactly ONE custom editor (last
 * `setEditorComponent` writer wins). pi-skill-desc must own the slot to track
 * the completion popup, so model-info-widget's editor install becomes inert and
 * its visual behavior lives here instead. See docs/adr/0001.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { parseFgAnsiToRgb, rgbToFgAnsi } from "./ansi-color.js";
import { stripAnsi } from "./format.js";

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

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const LEVEL_INDEX: Record<ThinkingLevel, number> = {
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

const THINKING_COLORS: Record<ThinkingLevel, string> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

/** How much the glow brightens toward white at the top level (0..1). */
const GLOW_FACTOR = 0.55;

/** Space padding around the label inside the border (each side). */
const LABEL_PAD = 1;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Color helpers: theme token ANSI → RGB → boosted glow ANSI
// (RGB/256 quantization lives in ansi-color.ts, shared with the chrome tiers)
// ---------------------------------------------------------------------------

/**
 * Build a border color function for a thinking level: takes the theme's
 * per-level color and brightens it toward white proportionally to the level,
 * so higher levels "glow" more intensely.
 */
function buildGlow(theme: ThemeLike, level: string): (s: string) => string {
  const base = parseFgAnsiToRgb(theme, THINKING_COLORS[level as ThinkingLevel]) ?? {
    r: 140,
    g: 140,
    b: 140,
  };
  const t = ((LEVEL_INDEX[level as ThinkingLevel] ?? 0) / 6) * GLOW_FACTOR;
  const r = Math.round(base.r + (255 - base.r) * t);
  const g = Math.round(base.g + (255 - base.g) * t);
  const b = Math.round(base.b + (255 - base.b) * t);
  const ansi = rgbToFgAnsi({ r, g, b }, theme.getColorMode());
  return (s: string) => `${ansi}${s}\x1b[39m`;
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

/** Format a context window size in tokens as a compact string (e.g. 128k, 32.8k, 2m). */
function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  const k = tokens / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

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

// ---------------------------------------------------------------------------
// Border detection & label embedding
// ---------------------------------------------------------------------------

/** Plain border line: entirely ─. */
function isPlainBorder(line: string): boolean {
  return /^─+$/.test(stripAnsi(line));
}

/** Scroll-indicator border: `─── ↑ 5 more ─────…` (created by pi's Editor). */
function isScrollBorder(line: string): boolean {
  return /^─── [↑↓] \d+ more/.test(stripAnsi(line));
}

/** Replace the left part of a plain top border with the label. */
function embedLabel(width: number, label: string, glow: (s: string) => string): string {
  // Padding collapses gracefully on very narrow terminals.
  const padCount = Math.min(LABEL_PAD, Math.max(0, Math.floor((width - 1) / 2)));
  const padding = padCount * 2;
  // Reserve at least one border char on each side.
  const labelText = truncateToWidth(label, Math.max(0, width - 2 - padding), "");
  const lw = visibleWidth(labelText);
  const leftWidth = Math.max(0, Math.min(2, width - lw - padding));
  const rightWidth = Math.max(0, width - lw - leftWidth - padding);
  const pad = " ".repeat(padCount);
  return glow("─".repeat(leftWidth)) + pad + labelText + pad + glow("─".repeat(rightWidth));
}

/**
 * Apply the glow + embedded model label to the editor's rendered lines
 * (same transformation model-info-widget's ModelInfoEditor.render applied).
 */
export function applyModelInfo(
  lines: string[],
  width: number,
  theme: ThemeLike,
  info: ModelInfo,
): string[] {
  const glow = buildGlow(theme, info.level);
  const label = buildLabel(theme, info.provider, info.modelId, info.level, info.contextWindow);

  // Top border (always lines[0]): embed the label into plain borders,
  // keep scroll indicators but recolor them.
  const top = lines[0];
  lines[0] = isScrollBorder(top) ? glow(stripAnsi(top)) : embedLabel(width, label, glow);

  // Bottom border: the last border-like line (autocomplete lines may follow).
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (isPlainBorder(line) || isScrollBorder(line)) {
      lines[i] = glow(stripAnsi(line));
      break;
    }
  }

  return lines;
}
