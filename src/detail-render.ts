/**
 * Pure, TUI-free rendering of the Detail window (ADR-0001).
 *
 * Given a highlighted completion candidate and window state, produces the
 * lines to render in the 5-line detail window above the input box.
 * No pi imports — this is the single testable seam of the extension.
 */

export interface DetailItem {
  label: string;
  kind: string;
  description: string;
}

/**
 * Rendered lines for the detail window: `[header, ...contentLines]`.
 *
 * - Returns `[]` when `item` is null or its description is empty/whitespace.
 * - Header is `<label> · <kind>`, suffixed with a ` offset/total` scroll
 *   marker (e.g. ` 3/8`) when the description overflows the window.
 * - The description is wrapped to `width` characters per line (simple
 *   character-based wrap; embedded newlines become paragraph breaks).
 * - Shrink-to-fit: exactly `min(maxLines, 1 + contentLines)` lines are
 *   returned (1 header + up to `maxLines - 1` content lines).
 * - `scrollOffset` is clamped into `[0, max(0, contentLines - (maxLines - 1))]`.
 */
export function renderDetail(
  item: DetailItem | null,
  width: number,
  maxLines: number,
  scrollOffset: number,
): string[] {
  if (!item || item.description.trim() === "") {
    return [];
  }

  const wrapWidth = Math.max(1, Math.floor(width));
  const safeMax = Math.max(1, Math.floor(maxLines));

  const contentLines = wrapDescription(item.description, wrapWidth);
  const capacity = Math.max(0, safeMax - 1);
  const maxOffset = capacity === 0 ? 0 : Math.max(0, contentLines.length - capacity);
  const offset = clamp(Math.floor(scrollOffset) || 0, 0, maxOffset);

  const visibleLines = contentLines.slice(offset, offset + capacity);

  const overflows = contentLines.length > capacity;
  const namePart = `${item.label} · ${item.kind}`;
  let header: string;
  if (overflows) {
    // Reserve room for the scroll marker so it always survives truncation.
    const marker = ` ${offset + 1}/${contentLines.length}`;
    const nameWidth = Math.max(0, wrapWidth - marker.length);
    header = truncateToWidth(namePart, nameWidth) + marker;
  } else {
    header = truncateToWidth(namePart, wrapWidth);
  }

  return [header, ...visibleLines];
}

/**
 * Next scroll offset after moving by `delta` (-1 = back/up, +1 = forward/down).
 *
 * - Returns 0 when there is nothing to scroll (description fits the window).
 * - Otherwise returns `offset + delta`, clamped to
 *   `[0, contentLines - (maxLines - 1)]`.
 */
export function scroll(
  offset: number,
  delta: -1 | 1,
  contentLines: number,
  maxLines: number,
): number {
  const capacity = Math.max(0, maxLines - 1);
  if (capacity === 0) {
    return 0;
  }
  const maxOffset = Math.max(0, contentLines - capacity);
  if (maxOffset === 0) {
    return 0;
  }
  return clamp(Math.floor(offset) + delta, 0, maxOffset);
}

function wrapDescription(description: string, width: number): string[] {
  const lines: string[] = [];
  for (const rawLine of description.split("\n")) {
    const trimmed = rawLine.replace(/\s+$/g, "");
    if (trimmed === "") {
      // Preserve explicit paragraph breaks (empty lines in the description).
      lines.push("");
      continue;
    }
    for (let i = 0; i < trimmed.length; i += width) {
      const segment = trimmed.slice(i, i + width).replace(/\s+$/g, "");
      if (segment !== "") {
        lines.push(segment);
      }
    }
  }
  return lines;
}

function truncateToWidth(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, width);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
