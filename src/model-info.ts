/**
 * Model-info border glow + label.
 *
 * Ported from the user's `model-info-widget` extension (~/.pi/agent/extensions/
 * model-info-widget/index.ts, MIT-style personal extension) so that the
 * TrackingEditor — which owns the editor slot for this extension — can keep
 * rendering the model label and thinking-level border glow that the original
 * widget provided. Self-contained: no imports beyond pi-tui's width utils.
 *
 * The port is intentional: pi allows exactly ONE custom editor (last
 * `setEditorComponent` writer wins). pi-skill-desc must own the slot to track
 * the completion popup, so model-info-widget's editor install becomes inert and
 * its visual behavior lives here instead. See docs/adr/0001.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

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
// Color helpers: theme ANSI → RGB → boosted glow ANSI
// ---------------------------------------------------------------------------

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const BASIC16: Array<[number, number, number]> = [
	[0, 0, 0],
	[128, 0, 0],
	[0, 128, 0],
	[128, 128, 0],
	[0, 0, 128],
	[128, 0, 128],
	[0, 128, 128],
	[192, 192, 192],
	[128, 128, 128],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[0, 0, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];
const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

function indexToRgb(n: number): { r: number; g: number; b: number } | null {
	if (n >= 0 && n < 16) {
		const [r, g, b] = BASIC16[n] ?? [0, 0, 0];
		return { r, g, b };
	}
	if (n >= 16 && n <= 231) {
		const v = n - 16;
		return {
			r: CUBE_VALUES[Math.floor(v / 36)] ?? 0,
			g: CUBE_VALUES[Math.floor(v / 6) % 6] ?? 0,
			b: CUBE_VALUES[v % 6] ?? 0,
		};
	}
	if (n >= 232 && n <= 255) {
		const gray = 8 + (n - 232) * 10;
		return { r: gray, g: gray, b: gray };
	}
	return null;
}

/** Parse a Theme.getFgAnsi() escape back into RGB. */
function parseFgAnsiToRgb(
	theme: ThemeLike,
	color: string,
): { r: number; g: number; b: number } | null {
	const ansi = theme.getFgAnsi(color);
	const trueColor = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
	if (trueColor)
		return {
			r: Number(trueColor[1]),
			g: Number(trueColor[2]),
			b: Number(trueColor[3]),
		};
	const palette = ansi.match(/38;5;(\d+)/);
	if (palette) return indexToRgb(Number(palette[1]));
	return null;
}

function findClosestCubeIndex(value: number): number {
	let minDist = Infinity;
	let minIdx = 0;
	for (let i = 0; i < CUBE_VALUES.length; i++) {
		const dist = Math.abs(value - (CUBE_VALUES[i] ?? 0));
		if (dist < minDist) {
			minDist = dist;
			minIdx = i;
		}
	}
	return minIdx;
}

function findClosestGrayIndex(gray: number): number {
	let minDist = Infinity;
	let minIdx = 0;
	for (let i = 0; i < GRAY_VALUES.length; i++) {
		const dist = Math.abs(gray - (GRAY_VALUES[i] ?? 0));
		if (dist < minDist) {
			minDist = dist;
			minIdx = i;
		}
	}
	return minIdx;
}

function colorDistance(
	r1: number,
	g1: number,
	b1: number,
	r2: number,
	g2: number,
	b2: number,
): number {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

/** Quantize an RGB value to the closest xterm-256 index (same as the theme loader). */
function rgbTo256(r: number, g: number, b: number): number {
	const rIdx = findClosestCubeIndex(r);
	const gIdx = findClosestCubeIndex(g);
	const bIdx = findClosestCubeIndex(b);
	const cubeR = CUBE_VALUES[rIdx] ?? 0;
	const cubeG = CUBE_VALUES[gIdx] ?? 0;
	const cubeB = CUBE_VALUES[bIdx] ?? 0;
	const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
	const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);
	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIdx = findClosestGrayIndex(gray);
	const grayValue = GRAY_VALUES[grayIdx] ?? 0;
	const grayIndex = 232 + grayIdx;
	const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);
	const maxC = Math.max(r, g, b);
	const minC = Math.min(r, g, b);
	const spread = maxC - minC;
	if (spread < 10 && grayDist < cubeDist) return grayIndex;
	return cubeIndex;
}

/**
 * Build a border color function for a thinking level: takes the theme's
 * per-level color and brightens it toward white proportionally to the level,
 * so higher levels "glow" more intensely.
 */
function buildGlow(theme: ThemeLike, level: string): (s: string) => string {
	const base = parseFgAnsiToRgb(
		theme,
		THINKING_COLORS[level as ThinkingLevel],
	) ?? {
		r: 140,
		g: 140,
		b: 140,
	};
	const t = ((LEVEL_INDEX[level as ThinkingLevel] ?? 0) / 6) * GLOW_FACTOR;
	const r = Math.round(base.r + (255 - base.r) * t);
	const g = Math.round(base.g + (255 - base.g) * t);
	const b = Math.round(base.b + (255 - base.b) * t);
	const ansi =
		theme.getColorMode() === "truecolor"
			? `\x1b[38;2;${r};${g};${b}m`
			: `\x1b[38;5;${rgbTo256(r, g, b)}m`;
	return (s: string) => `${ansi}${s}\x1b[39m`;
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

/** Format a context window size in tokens as a compact string (e.g. 128k, 32.8k, 2m). */
function formatContextWindow(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) return "";
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000;
		return `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
	}
	const k = tokens / 1000;
	return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

function buildLabel(
	theme: ThemeLike,
	provider: string,
	modelId: string,
	level: string,
	contextWindow: number,
): string {
	const providerPart = provider !== "" ? theme.fg("dim", `${provider}/`) : "";
	const modelPart = theme.fg(
		"accent",
		theme.bold(modelId !== "" ? modelId : "unknown"),
	);
	const levelPart = theme.getThinkingBorderColor(level)(level);
	const ctxText =
		formatContextWindow(contextWindow) !== ""
			? `${theme.fg("dim", " · ")}${theme.fg("muted", formatContextWindow(contextWindow))}`
			: "";
	return `${providerPart}${modelPart}${theme.fg("dim", " · ")}${levelPart}${ctxText}`;
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
function embedLabel(
	width: number,
	label: string,
	glow: (s: string) => string,
): string {
	// Padding collapses gracefully on very narrow terminals.
	const padCount = Math.min(
		LABEL_PAD,
		Math.max(0, Math.floor((width - 1) / 2)),
	);
	const padding = padCount * 2;
	// Reserve at least one border char on each side.
	const labelText = truncateToWidth(
		label,
		Math.max(0, width - 2 - padding),
		"",
	);
	const lw = visibleWidth(labelText);
	const leftWidth = Math.max(0, Math.min(2, width - lw - padding));
	const rightWidth = Math.max(0, width - lw - leftWidth - padding);
	const pad = " ".repeat(padCount);
	return (
		glow("─".repeat(leftWidth)) +
		pad +
		labelText +
		pad +
		glow("─".repeat(rightWidth))
	);
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
	const label = buildLabel(
		theme,
		info.provider,
		info.modelId,
		info.level,
		info.contextWindow,
	);

	// Top border (always lines[0]): embed the label into plain borders,
	// keep scroll indicators but recolor them.
	const top = lines[0];
	lines[0] = isScrollBorder(top)
		? glow(stripAnsi(top))
		: embedLabel(width, label, glow);

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
