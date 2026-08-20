import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  applyModelInfo,
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
    },
  ): string[] {
    let out = [...lines];
    if (out.length === 0) return out;

    // Top glow + label
    if (opts.glowEnabled) {
      out = applyModelInfo(
        out,
        width,
        this.getLiveTheme(),
        this.getModelInfo(),
      );
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
