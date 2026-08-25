/**
 * ChromeComposition — deep module owning chrome glyph/theme derivation behind one seam.
 *
 * Problem it solves (C3): glyphs (resolveGlyphs / resolveIconMode) and the live TUI theme
 * (with its `fg` + optional `getThinkingBorderColor`) were re-derived at every chrome island:
 * live-border called resolveGlyphs in 3 methods, footer once, and the theme was reached
 * through ~8 `as unknown as { ... }` SAFETY casts. A changed glyph or a pi theme shape change
 * thus required touching 3-4 modules with no locality.
 *
 * Depth: one small interface (glyphs + isAscii + fg/dim/glow + format* helpers) hides
 * icon-mode resolution, the SAFETY theme cast, colour application, and the chrome format
 * entry points (context bar, telemetry, tokens, run activity, stall). Callers learn one
 * shape; LiveBorder's islands become thin lookups.
 *
 * Internal seams (resolveGlyphs, resolveIconMode, formatTurnTelemetry, formatTelemetryTokens,
 * formatRunActivityTopRight, formatTopContextFromSnapshot) stay inside this module, not part
 * of its external seam. Two adapters (LiveBorder live chrome, footer/border elsewhere)
 * justify the seam.
 */

import type { IconGlyphs, IconMode } from "./icons.js";
import { resolveGlyphs, resolveIconMode } from "./icons.js";
import type { ChromeSnapshot } from "./chrome-state.js";
import { formatTopContextFromSnapshot } from "./chrome-state.js";
import type { RunActivitySnapshot } from "./run-activity.js";
import { formatRunActivityTopRight } from "./run-activity.js";
import type { TelemetryConfig, TurnTelemetry } from "./telemetry.js";
import {
  formatTelemetryTokens,
  formatTurnDuration,
  formatTurnTelemetry,
} from "./telemetry.js";

/** Typed fg surface — the only theme capability the chrome needs. */
export interface ChromeThemeLike {
  fg(style: string, s: string): string;
}

/**
 * Read the live pi theme into a typed { fg } surface. The cast is a SAFETY seam — a pi theme
 * missing `fg` degrades to identity rather than throwing, keeping the chrome resilient.
 */
export function adaptTheme(rawTheme: unknown): ChromeThemeLike {
  const t = rawTheme as { fg?: (style: string, s: string) => string }; // SAFETY: pi theme seam — fg is optional, guarded below
  return {
    fg: (style, s) => (typeof t.fg === "function" ? t.fg(style, s) : s),
  };
}

/** Optional thinking-border glow (pi theme extension). Falls back to identity. */
export function resolveGlow(
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

export class ChromeComposition {
  readonly glyphs: IconGlyphs;
  readonly isAscii: boolean;
  private readonly theme: ChromeThemeLike;
  private readonly glow?: (level: string, s: string) => string;

  constructor(
    iconMode: IconMode,
    rawTheme: unknown,
    opts: {
      /** pre-resolved glow for the model's thinking level, when available */
      glow?: (level: string, s: string) => string;
    } = {},
  ) {
    this.glyphs = resolveGlyphs(iconMode);
    this.isAscii = resolveIconMode(iconMode) === "ascii";
    this.theme = adaptTheme(rawTheme);
    this.glow = opts.glow ?? resolveGlow(rawTheme);
  }

  /** Colour a string with a theme style (derived once, cast cached). */
  fg(style: string, s: string): string {
    return this.theme.fg(style, s);
  }

  dim(s: string): string {
    return this.fg("dim", s);
  }

  /** Apply the thinking-border glow at the given level (identity when unavailable). */
  applyGlow(level: string, s: string): string {
    return this.glow ? this.glow(level, s) : s;
  }

  /** Top context bar from a chrome snapshot. */
  formatTopContext(snapshot: ChromeSnapshot, showIconBar: boolean): string {
    return formatTopContextFromSnapshot(
      snapshot,
      this.theme,
      this.glyphs,
      this.isAscii,
      showIconBar,
    );
  }

  /** Bottom telemetry string (TPS/TTFT/stalls) for a turn. */
  formatTurnTelemetry(
    tel: TurnTelemetry,
    cfg: TelemetryConfig,
    glyphs?: Parameters<typeof formatTurnTelemetry>[3],
  ): string {
    return formatTurnTelemetry(tel, this.theme, cfg, glyphs ?? this.glyphs);
  }

  /** Tokens `↑ n · ↓ m` line for a turn. */
  formatTelemetryTokens(
    tel: TurnTelemetry,
    cfg: TelemetryConfig,
    glyphs?: Parameters<typeof formatTelemetryTokens>[3],
  ): string {
    return formatTelemetryTokens(tel, this.theme, cfg, glyphs ?? this.glyphs);
  }

  /** Run-activity top-right (turns · duration · tools · failed). */
  formatRunActivityTopRight(snap: RunActivitySnapshot): string {
    return formatRunActivityTopRight(snap, this.theme);
  }

  /** Stall badge `!N×dur` for the top-right stall segment. */
  formatStall(tel: TurnTelemetry): string {
    return this.fg(
      "warning",
      `${this.glyphs.stall}${tel.stallCount}×${formatTurnDuration(tel.stallMs).trim()}`,
    );
  }
}
