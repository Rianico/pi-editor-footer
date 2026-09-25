/**
 * chrome-theme — the live pi theme → typed { fg, fgHex } surface (C3 dissolve).
 *
 * Formerly the ChromeComposition class: every format* member was a one-line
 * pass-through to the module that really implements it (telemetry.ts,
 * run-activity.ts, chrome-state.ts), and the class was rebuilt on every render.
 * The composition seam is dissolved — callers now invoke those functions
 * directly with this adapted theme; glyph resolution goes straight to icons.ts.
 *
 * What genuinely lives here: the resilient theme cast. The pi theme resolves
 * named tokens only and throws on unknown names, so raw-hex callers (context
 * tiers) need the fgHex escape hatch; a theme missing `fg` degrades to
 * identity instead of crashing the chrome.
 */

import { hexFg } from "./ansi-color.js";

/** Typed fg surface — the only theme capability the chrome needs. */
export interface ChromeThemeLike {
  fg(style: string, s: string): string;
  fgHex(hex: string, s: string): string;
}

/**
 * Read the live pi theme into a typed { fg, fgHex } surface. The cast is a SAFETY
 * seam — a pi theme missing `fg` degrades to identity rather than throwing, keeping
 * the chrome resilient. `fgHex` needs no theme call at all: the named-token lookup
 * rejects raw hex, so hex is rendered straight to SGR at the theme's color mode.
 */
export function adaptTheme(rawTheme: unknown): ChromeThemeLike {
  const t = rawTheme as {
    fg?: (style: string, s: string) => string;
    // SAFETY: pi theme seam — getColorMode is optional, defaulted below
    getColorMode?: () => string;
  };
  const mode = typeof t.getColorMode === "function" ? t.getColorMode() : undefined;
  return {
    fg: (style, s) => (typeof t.fg === "function" ? t.fg(style, s) : s),
    fgHex: (hex, s) => hexFg(hex, mode)(s),
  };
}
