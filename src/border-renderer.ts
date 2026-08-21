import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  applyModelInfo,
  buildLabel,
  type ModelInfo,
  type ThemeLike,
} from "./model-info.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function isBorderLine(line: string): boolean {
  const plain = stripAnsi(line);
  return /^─+$/.test(plain) || /^─── [↑↓] \d+ more/.test(plain);
}

/**
 * BorderRenderer — deep module owning top glow + bottom border embedding.
 * Deduplicates stripAnsi/isBorder logic previously spread between model-info.ts
 * and tracking-editor.ts. Behind a single seam, tested via render().
 */
export class BorderRenderer {
  constructor(
    private readonly getLiveTheme: () => ThemeLike,
    private readonly getModelInfo: () => ModelInfo,
  ) {}

  renderWithBorders(
    lines: string[],
    width: number,
    opts: {
      glowEnabled: boolean;
      telemetryText?: string;
      bottomLeftText?: string;
      topRightText?: string;
      topContextText?: string;
    },
  ): string[] {
    let out = [...lines];
    if (out.length === 0) return out;

    // Top: model info left, context bar right of it, run-activity far right
    const hasTop = opts.glowEnabled || opts.topRightText || opts.topContextText;
    if (hasTop) {
      const theme = this.getLiveTheme();
      const info = this.getModelInfo();
      const glow = (s: string): string => {
        try {
          const maybeGlow = (
            theme as unknown as {
              getThinkingBorderColor?: (l: string) => (s: string) => string;
            }
          ).getThinkingBorderColor;
          if (typeof maybeGlow === "function")
            return maybeGlow.call(theme, info.level)(s);
        } catch {
          // ignore
        }
        return s;
      };
      if (opts.glowEnabled) {
        // Build left label; if context bar present, append it to the right of model info with pipe separator
        let leftLabel = buildLabel(theme, info.provider, info.modelId, info.level, info.contextWindow);
        if (opts.topContextText) {
          leftLabel = `${leftLabel} ${theme.fg("dim", "|")} ${opts.topContextText}`;
        }
        // Embed left (model+context) and optional right (run activity) in one pass to avoid double-truncate
        if (opts.topRightText) {
          out = embedTopWithLeftAndRight(out, width, leftLabel, opts.topRightText, glow);
        } else {
          // Only left (model+context), no right — use applyModelInfo replacement but with combined left
          // Reuse embedTopWithLeftAndRight with empty right
          out = embedTopWithLeftAndRight(out, width, leftLabel, "", glow);
        }
      } else if (opts.topContextText || opts.topRightText) {
        // No glow, but still need top borders for context/run activity
        const left = opts.topContextText ?? "";
        const right = opts.topRightText ?? "";
        if (left && right) {
          out = embedTopWithLeftAndRight(out, width, left, right, glow);
        } else if (left) {
          out = embedTopRightBorder(out, width, left, glow);
        } else if (right) {
          out = embedTopRightBorder(out, width, right, glow);
        }
      }
    }
    // Bottom embedding (telemetry left/right)
    if (opts.telemetryText || opts.bottomLeftText) {
      const theme = this.getLiveTheme();
      const glow = (s: string): string => {
        try {
          const maybeGlow = (
            theme as unknown as {
              getThinkingBorderColor?: (l: string) => (s: string) => string;
            }
          ).getThinkingBorderColor;
          if (typeof maybeGlow === "function")
            return maybeGlow.call(theme, this.getModelInfo().level)(s);
        } catch {
          // ignore
        }
        return s;
      };
      out = embedBottomBorder(
        out,
        width,
        opts.bottomLeftText ?? "",
        opts.telemetryText ?? "",
        glow,
      );
    }
    return out;
  }
}

function embedTopWithLeftAndRight(
  lines: string[],
  width: number,
  leftText: string,
  rightText: string,
  getGlow: (s: string) => string,
): string[] {
  if (lines.length === 0) return lines;
  const top = lines[0] ?? "";
  const plainTop = stripAnsi(top);
  if (/^─── [↑↓] \d+ more/.test(plainTop)) return lines;
  const leftW = leftText ? visibleWidth(leftText) : 0;
  const rightW = rightText ? visibleWidth(rightText) : 0;
  const maxLeft = rightText ? Math.max(0, width - rightW - 6) : width - 3;
  const maxRight = leftText ? Math.max(0, width - leftW - 6) : width - 3;
  let displayLeft = leftText;
  let displayRight = rightText;
  if (leftW > maxLeft) displayLeft = truncateToWidth(leftText, maxLeft, "");
  if (rightW > maxRight) displayRight = truncateToWidth(rightText, maxRight, "");
  const leftSegment = displayLeft ? `${getGlow("─")} ${displayLeft} ` : getGlow("─");
  const rightSegment = displayRight ? ` ${displayRight} ${getGlow("─")}` : getGlow("─");
  const used = visibleWidth(leftSegment) + visibleWidth(rightSegment);
  const middleWidth = Math.max(0, width - used);
  const middle = getGlow("─".repeat(middleWidth));
  const embedded = `${leftSegment}${middle}${rightSegment}`;
  const result = [...lines];
  result[0] = truncateToWidth(embedded, width, "");
  if (visibleWidth(embedded) !== width) result[0] = embedded;
  return result;
}

function embedBottomBorder(
  lines: string[],
  width: number,
  leftText: string,
  rightText: string,
  getGlow: (s: string) => string,
): string[] {
  if ((!leftText && !rightText) || lines.length === 0) return lines;
  let bottomIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isBorderLine(lines[i] ?? "")) {
      bottomIdx = i;
      break;
    }
  }
  if (bottomIdx === -1) return lines;
  const leftW = leftText ? visibleWidth(leftText) : 0;
  const rightW = rightText ? visibleWidth(rightText) : 0;
  const maxLeft = rightText ? Math.max(0, width - rightW - 6) : width - 3;
  const maxRight = leftText ? Math.max(0, width - leftW - 6) : width - 3;
  let displayLeft = leftText;
  let displayRight = rightText;
  if (leftW > maxLeft) displayLeft = truncateToWidth(leftText, maxLeft, "");
  if (rightW > maxRight)
    displayRight = truncateToWidth(rightText, maxRight, "");
  const leftSegment = displayLeft
    ? `${getGlow("─")} ${displayLeft} `
    : getGlow("─");
  const rightSegment = displayRight
    ? ` ${displayRight} ${getGlow("─")}`
    : getGlow("─");
  const used = visibleWidth(leftSegment) + visibleWidth(rightSegment);
  const middleWidth = Math.max(0, width - used);
  const middle = getGlow("─".repeat(middleWidth));
  const embedded = `${leftSegment}${middle}${rightSegment}`;
  const result = [...lines];
  result[bottomIdx] = truncateToWidth(embedded, width, "");
  if (visibleWidth(embedded) !== width) result[bottomIdx] = embedded;
  return result;
}

function embedTopRightBorder(
  lines: string[],
  width: number,
  rightText: string,
  getGlow: (s: string) => string,
): string[] {
  if (!rightText || lines.length === 0) return lines;
  // Top border is always lines[0] — unless it's a scroll indicator, treat similarly
  const top = lines[0] ?? "";
  const plainTop = stripAnsi(top);
  // If top is scroll indicator, don't embed right — keep glow recolor only
  if (/^─── [↑↓] \d+ more/.test(plainTop)) return lines;
  const rightW = visibleWidth(rightText);
  // left label already embedded by applyModelInfo — its visible width is width - middle - right
  // We need to truncate right if too wide, preserving at least 10 chars for left
  const maxRight = Math.max(0, width - 12);
  let displayRight = rightText;
  if (rightW > maxRight)
    displayRight = truncateToWidth(rightText, maxRight, "");
  const displayW = visibleWidth(displayRight);
  // Rebuild top: keep existing left-embedded line, replace its right tail
  const existing = lines[0] ?? "";
  // Strip then rebuild: we need to preserve left part and insert right
  // Simple approach: truncate existing to width - displayW - 3, then add " " + displayRight + " " + glow("─")
  const availableForLeft = Math.max(0, width - displayW - 3);
  const leftPart = truncateToWidth(existing, availableForLeft, "");
  // Ensure leftPart ends with glow dash if truncated
  const rightSegment = ` ${displayRight} ${getGlow("─")}`;
  const leftW2 = visibleWidth(leftPart);
  const rightW2 = visibleWidth(rightSegment);
  const middleWidth = Math.max(0, width - leftW2 - rightW2);
  const middle = getGlow("─".repeat(middleWidth));
  const embedded = `${leftPart}${middle}${rightSegment}`;
  const result = [...lines];
  result[0] = truncateToWidth(embedded, width, "");
  if (visibleWidth(embedded) !== width) result[0] = embedded;
  return result;
}
