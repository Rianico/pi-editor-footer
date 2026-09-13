/**
 * AnsiColor — hex → SGR foreground emission + the shared RGB/256 quantizer.
 *
 * Problem it solves: the pi theme resolves *named* tokens only
 * (`theme.fg("success", s)`) and throws `Unknown theme color: …` for anything
 * else, so a caller that needs an exact hex (context-pressure tiers) cannot
 * reach the theme's own `fgAnsi`. Reimplementing the conversion per call site
 * duplicated ~100 lines of color math that the thinking-border glow in
 * model-info.ts had already written.
 *
 * Depth: one interface (`hexFg`) hides hex parsing, 256-cube quantization and
 * terminal color-mode branching. Two adapters (chrome context tiers, model-info
 * glow) justify the seam.
 */
/** Terminal color fidelity reported by the pi theme. */
export type ColorMode = "truecolor" | "256color";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Structural subset of the pi theme needed to read a token's ANSI sequence. */
export interface FgAnsiSource {
  getFgAnsi(color: string): string;
}

const BASIC16: ReadonlyArray<readonly [number, number, number]> = [
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

/** 6x6x6 color-cube channel values (indices 0-5). */
const CUBE_VALUES = [0, 95, 135, 175, 215, 255];

/** Grayscale ramp values (indices 232-255: 24 grays from 8 to 238). */
const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

/** Anything but the truecolor marker means the 256-color ramp. */
export function normalizeColorMode(mode: string | undefined): ColorMode {
  return mode === "truecolor" ? "truecolor" : "256color";
}

export function indexToRgb(n: number): Rgb | null {
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
  // Weighted Euclidean distance (the eye is more sensitive to green).
  return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

/** Quantize RGB to the closest xterm-256 index (same rule as the theme loader). */
export function rgbTo256(r: number, g: number, b: number): number {
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
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  // Only consider grayscale when the color is nearly neutral AND closer.
  if (spread < 10 && grayDist < cubeDist) return grayIndex;
  return cubeIndex;
}

/** Parse `#RRGGBB`. Throws on malformed input — callers pass literals, not user data. */
export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  if (cleaned.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
  const { r, g, b } = {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return { r, g, b };
}

/** Parse a theme token's ANSI escape back into RGB (truecolor or 256 index). */
export function parseFgAnsiToRgb(theme: FgAnsiSource, color: string): Rgb | null {
  const ansi = theme.getFgAnsi(color);
  const trueColor = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  if (trueColor) {
    return {
      r: Number(trueColor[1]),
      g: Number(trueColor[2]),
      b: Number(trueColor[3]),
    };
  }
  const palette = ansi.match(/38;5;(\d+)/);
  if (palette) return indexToRgb(Number(palette[1]));
  return null;
}

/** SGR foreground sequence for an RGB value at the terminal's color fidelity. */
export function rgbToFgAnsi({ r, g, b }: Rgb, mode: string | undefined): string {
  return normalizeColorMode(mode) === "truecolor"
    ? `\x1b[38;2;${r};${g};${b}m`
    : `\x1b[38;5;${rgbTo256(r, g, b)}m`;
}

/**
 * Color `s` with an exact hex, bypassing the theme's named-token lookup.
 * Returned painter resets only the foreground (`\x1b[39m`), matching `theme.fg`.
 */
export function hexFg(hex: string, mode: string | undefined): (s: string) => string {
  const ansi = rgbToFgAnsi(hexToRgb(hex), mode);
  return (s: string) => `${ansi}${s}\x1b[39m`;
}
