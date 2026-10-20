import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isEditorBorderLine, isEditorScrollBorderLine } from "./layout.js";
import { buildLabel, resolveThinkingGlow, type ModelInfo, type ThemeLike } from "./model-info.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Rows `renderWithBorders` prepends above the editor's own top border.
 *
 * Two at most, in this order: a **status row** (a pi status indicator we cannot
 * embed — retry/compaction/branch-summary — rendered above the chrome because pi
 * hands every indicator to `setWorkingStatusIndicator` once the editor claims
 * `embedWorkingStatus`), then the **usage row** (working spinner + tokens + run
 * activity). Context/glow embed into the existing top border, and the bottom
 * only rewrites a row. Editor mouse hit-testing (`Editor.handleMouse`, pi-tui
 * 1.3.0) indexes rows relative to the editor's own
 * `[top border][content…][bottom border]` output, so it has to undo this shift —
 * see `TrackingEditor.handleMouse`. Keep the predicate here so render and
 * hit-testing can never drift.
 */
export function rowsPrependedAboveEditor(opts: {
  statusRow?: boolean;
  usageRow?: boolean;
}): number {
  return (opts.statusRow ? 1 : 0) + (opts.usageRow ? 1 : 0);
}

/** `╭ ╮ ╰ ╯ │ ─` — box drawing, never icon fallbacks: `icons.mode` swaps glyph *sets*, not chrome. */
export const FRAME_GLYPHS = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  rail: "│",
  dash: "─",
} as const;

/** Two rails + one column of inner padding on each side. */
export const EDITOR_FRAME_CHROME = 4;

/** Below this the frame costs more than it communicates: render unframed. */
export const MIN_FRAMED_WIDTH = 30;

/**
 * Width plan for the editor. Framing spends `EDITOR_FRAME_CHROME` columns on rails
 * and inner padding, so the body has to be rendered at `bodyWidth`, not `width` —
 * that is what keeps wrapping, the caret and the scroll window honest.
 */
export function editorFramePlan(width: number): { framed: boolean; bodyWidth: number } {
  // Widths at or below the minimum lose more to rails than the frame communicates
  // (acceptance for #54 words it "30 or below"), so they render unframed.
  const framed = width > MIN_FRAMED_WIDTH;
  return { framed, bodyWidth: framed ? Math.max(1, width - EDITOR_FRAME_CHROME) : width };
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
      topTokensText?: string;
      /** Already-styled status segment — `⠋ Working` while running, `● Ready` once it settles; leftmost on the usage row. */
      workingText?: string;
      /** Already-styled pi status we do not embed (retry…); rendered above the usage row. */
      statusLineText?: string;
    },
  ): string[] {
    let out = [...lines];
    if (out.length === 0) return out;
    if (editorFramePlan(width).framed) return this.renderFramed(out, width, opts);
    // Top: model info left, context bar right of it, run-activity far right
    const hasTop =
      opts.glowEnabled ||
      opts.topContextText ||
      (!opts.topTokensText && !opts.workingText && opts.topRightText);
    if (hasTop) {
      const theme = this.getLiveTheme();
      const info = this.getModelInfo();
      // C3: single glow home in model-info.ts; identity fallback explicit at this site.
      const glowFor = resolveThinkingGlow(theme);
      const glow = (s: string): string => (glowFor ? glowFor(info.level, s) : s);
      // When tokens line exists, right moves to that line (one padding) — don't duplicate on top
      const topRightForTop = opts.topTokensText || opts.workingText ? "" : opts.topRightText;
      if (opts.glowEnabled) {
        // Build left label; if context bar present, append it to the right of model info with pipe separator
        let leftLabel = buildLabel(
          theme,
          info.provider,
          info.modelId,
          info.level,
          info.contextWindow,
        );
        if (opts.topContextText) {
          leftLabel = `${leftLabel} ${theme.fg("dim", "|")} ${opts.topContextText}`;
        }
        // Embed left (model+context) and optional right (run activity) in one pass to avoid double-truncate
        if (topRightForTop) {
          out = embedTopWithLeftAndRight(out, width, leftLabel, topRightForTop, glow);
        } else {
          // Only left (model+context), no right — reuse embedTopWithLeftAndRight with empty right
          out = embedTopWithLeftAndRight(out, width, leftLabel, "", glow);
        }
      } else if (opts.topContextText || topRightForTop) {
        // No glow, but still need top borders for context/run activity
        const left = opts.topContextText ?? "";
        const right = topRightForTop ?? "";
        if (left && right) {
          out = embedTopWithLeftAndRight(out, width, left, right, glow);
        } else if (left) {
          out = embedTopRightBorder(out, width, left, glow);
        } else if (right) {
          out = embedTopRightBorder(out, width, right, glow);
        }
      }
    }

    // Rows above the top border — left aligned, no border.
    // Usage row: the working spinner is the leftmost SECTION (ADR-0004 rev 2), so it
    // joins the tokens with `·`; run activity is a separate FIELD after ` | `.
    // Status row: pi indicators we cannot embed keep rendering above the editor.
    out = this.prependRows(out, width, opts);

    // Bottom embedding (telemetry left/right)
    if (opts.telemetryText || opts.bottomLeftText) {
      const theme = this.getLiveTheme();
      // C3: single glow home; this site re-reads the live model level per call — kept explicit.
      const glowFor = resolveThinkingGlow(theme);
      const glow = (s: string): string => (glowFor ? glowFor(this.getModelInfo().level, s) : s);
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
  /**
   * Usage + status rows above the chrome — the line #55 put the working spinner on.
   * Emitted bottom-up because `embedTokensAbove` prepends; the status row ends on top.
   */
  private prependRows(
    lines: string[],
    width: number,
    opts: {
      topTokensText?: string;
      topRightText?: string;
      workingText?: string;
      statusLineText?: string;
    },
  ): string[] {
    const statusLineText = opts.statusLineText ?? "";
    const usageParts = [opts.workingText ?? "", opts.topTokensText ?? ""].filter(Boolean);
    const tokensRight = opts.topRightText ?? "";
    const usageRow = usageParts.length > 0 || tokensRight !== "";
    if (!usageRow && !statusLineText) return lines;
    // SAFETY: pi theme seam — fg is optional theme method
    const themeForRows = this.getLiveTheme() as unknown as {
      fg: (c: string, t: string) => string;
    }; // SAFETY: intentional unsafe cast — validated at runtime
    const fg = themeForRows.fg;
    const dimSection = typeof fg === "function" ? fg.call(themeForRows, "dim", " · ") : " · ";
    const dimField = typeof fg === "function" ? fg.call(themeForRows, "dim", " | ") : " | ";
    const usage = usageParts.join(dimSection);
    const usageText = usage
      ? tokensRight
        ? `${usage}${dimField}${tokensRight}`
        : usage
      : tokensRight;
    let out = [...lines];
    if (usageText) out = embedTokensAbove(out, width, usageText);
    if (statusLineText) out = embedTokensAbove(out, width, statusLineText);
    return out;
  }

  /**
   * Rounded frame (ADR-0004 rev 2): `╭─ model · context ───╮`, `│ body │`,
   * `╰─ ─── telemetry ─╯`.
   *
   * `lines` already came from the editor rendered at `width - EDITOR_FRAME_CHROME`,
   * so rails cost exactly two columns per side and wrapping is untouched. Only the
   * editor block is framed: autocomplete lines are shifted to the body column and
   * left below the frame, which keeps the popup aligned to the caret.
   */
  private renderFramed(
    lines: string[],
    width: number,
    opts: {
      glowEnabled: boolean;
      telemetryText?: string;
      bottomLeftText?: string;
      topContextText?: string;
      topTokensText?: string;
      topRightText?: string;
      workingText?: string;
      statusLineText?: string;
    },
  ): string[] {
    const { bodyWidth } = editorFramePlan(width);
    const { top, body, bottom, tail } = splitEditorBlock(lines);
    const theme = this.getLiveTheme();
    const info = this.getModelInfo();
    const glowFor = resolveThinkingGlow(theme);
    const glow = (s: string): string => (glowFor ? glowFor(info.level, s) : s);
    const frame = (s: string): string => (opts.glowEnabled ? glow(s) : s);

    let label = buildLabel(theme, info.provider, info.modelId, info.level, info.contextWindow);
    if (opts.topContextText) {
      label = `${label} ${theme.fg("dim", "|")} ${opts.topContextText}`;
    }

    // Run activity lives on the usage row while that row exists (#55); with no usage
    // row it keeps its old home at the right end of the top rule.
    const usageRowExists = Boolean(opts.workingText || opts.topTokensText || opts.topRightText);
    const topRight = usageRowExists ? "" : (opts.topRightText ?? "");
    const out: string[] = [frameTopRule(width, [scrollLabelOf(top), label], topRight, frame)];
    for (const line of body) out.push(frameBodyLine(line, bodyWidth, frame));
    out.push(
      frameBottomRule(
        width,
        [scrollLabelOf(bottom), opts.bottomLeftText ?? ""],
        opts.telemetryText ?? "",
        frame,
      ),
    );
    for (const line of tail) out.push(`  ${truncateToWidth(line, Math.max(0, width - 2), "")}`);
    return this.prependRows(out, width, opts);
  }
}

/** Editor block + autocomplete tail: `[top][body…][bottom][autocomplete…]`. */
function splitEditorBlock(lines: string[]): {
  top: string;
  body: string[];
  bottom: string;
  tail: string[];
} {
  const top = lines[0] ?? "";
  if (lines.length < 3) return { top, body: [], bottom: "", tail: lines.slice(1) };
  let bottomIdx = lines.length - 1;
  for (let i = lines.length - 1; i >= 1; i--) {
    if (isEditorBorderLine(lines[i] ?? "")) {
      bottomIdx = i;
      break;
    }
  }
  return {
    top,
    body: lines.slice(1, bottomIdx),
    bottom: lines[bottomIdx] ?? "",
    tail: lines.slice(bottomIdx + 1),
  };
}

/** `↑ N more` / `↓ N more` inside a pi scroll border; "" for a plain border. */
function scrollLabelOf(line: string): string {
  const plain = stripAnsi(line);
  if (!isEditorScrollBorderLine(plain)) return "";
  return plain.replace(/─/g, " ").replace(/\s+/g, " ").trim();
}

function frameBodyLine(line: string, bodyWidth: number, frame: (s: string) => string): string {
  const content = truncateToWidth(line, bodyWidth, "");
  const pad = Math.max(0, bodyWidth - visibleWidth(content));
  const rail = frame(FRAME_GLYPHS.rail);
  return `${rail} ${content}${" ".repeat(pad)} ${rail}`;
}

/**
 * One frame rule: `╭─ left label ──── right text ─╮`.
 *
 * Budgets are measured in *visible* columns and charged for the whitespace each
 * segment costs (` seg ` plus the dash that follows it = segW + 3), so the fill
 * always lands the closing corner exactly on the last column.
 */
function frameRule(
  width: number,
  leftSegments: string[],
  rightText: string,
  leftCorner: string,
  rightCorner: string,
  frame: (s: string) => string,
): string {
  const gDash = frame(FRAME_GLYPHS.dash);
  const rightW = rightText ? visibleWidth(rightText) + 3 : 0;
  let left = gDash;
  for (const raw of leftSegments.filter(Boolean)) {
    const budget = width - 2 - visibleWidth(left) - 3 - rightW;
    if (budget <= 1) break;
    left += ` ${truncateToWidth(raw, budget, "…")} ${gDash}`;
  }
  const rightBudget = Math.max(0, width - 2 - visibleWidth(left) - 3);
  const right =
    rightText && rightBudget > 1 ? ` ${truncateToWidth(rightText, rightBudget, "…")} ${gDash}` : "";
  const fill = Math.max(0, width - 2 - visibleWidth(left) - visibleWidth(right));
  return `${frame(leftCorner)}${left}${frame(FRAME_GLYPHS.dash.repeat(fill))}${right}${frame(rightCorner)}`;
}

function frameTopRule(
  width: number,
  segments: string[],
  rightText: string,
  frame: (s: string) => string,
): string {
  return frameRule(width, segments, rightText, FRAME_GLYPHS.topLeft, FRAME_GLYPHS.topRight, frame);
}

function frameBottomRule(
  width: number,
  leftSegments: string[],
  rightText: string,
  frame: (s: string) => string,
): string {
  return frameRule(
    width,
    leftSegments,
    rightText,
    FRAME_GLYPHS.bottomLeft,
    FRAME_GLYPHS.bottomRight,
    frame,
  );
}
function embedTokensAbove(lines: string[], width: number, tokensText: string): string[] {
  if (!tokensText || lines.length === 0) return lines;
  // Left aligned, no border; one leading padding as before
  const raw = ` ${tokensText}`;
  const display = truncateToWidth(raw, width, "");
  const result = [...lines];
  result.splice(0, 0, display);
  return result;
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
  if (isEditorScrollBorderLine(plainTop)) return lines;
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
    if (isEditorBorderLine(lines[i] ?? "")) {
      bottomIdx = i;
      break;
    }
  }
  // A scroll indicator owns the bottom border line: pi's `↓ N more` hint survives
  // unchanged and embedding only applies to non-scrolled borders (issue #39).
  if (bottomIdx === -1 || isEditorScrollBorderLine(lines[bottomIdx] ?? "")) return lines;
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
  if (isEditorScrollBorderLine(plainTop)) return lines;
  const rightW = visibleWidth(rightText);
  // left label already embedded on the top border — its visible width is width - middle - right
  // We need to truncate right if too wide, preserving at least 10 chars for left
  const maxRight = Math.max(0, width - 12);
  let displayRight = rightText;
  if (rightW > maxRight) displayRight = truncateToWidth(rightText, maxRight, "");
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
