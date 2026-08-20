import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "./format.js";

export { truncateToWidth, visibleWidth };
export { stripAnsi } from "./format.js";

export interface Theme {
  fg(style: string, s: string): string;
}

export type PrioritizedSegment = {
  text: string;
  priority: number;
  compactText?: string;
  truncate?: (text: string, maxWidth: number, ellipsis: string) => string;
};

export function alignRight(
  left: string,
  right: string,
  width: number,
  theme: Theme,
): string {
  const rightW = visibleWidth(right);
  if (rightW > width) {
    right = truncateToWidth(right, width, theme.fg("dim", "..."));
  }
  const leftW = visibleWidth(left);
  const rightW2 = visibleWidth(right);
  const pad = width - leftW - rightW2;
  if (pad >= 1) {
    return left + " ".repeat(pad) + right;
  }
  const availableForLeft = Math.max(0, width - rightW2 - 1);
  const truncatedLeft =
    availableForLeft > 0
      ? truncateToWidth(left, availableForLeft, theme.fg("dim", "..."))
      : "";
  return truncatedLeft ? truncatedLeft + " " + right : right;
}

export function fitSegmentsByPriority(
  segs: readonly PrioritizedSegment[],
  maxW: number,
  ellipsis = "...",
): string[] {
  const items = segs.map((s) => ({
    text: s.text,
    compactText: s.compactText,
    priority: s.priority,
    truncate: s.truncate,
    w: visibleWidth(s.text),
  }));
  const totalW = () => {
    const active = items.filter((it) => it.text !== "");
    return (
      active.reduce((a, it) => a + it.w, 0) + Math.max(0, active.length - 1)
    );
  };
  if (totalW() > maxW) {
    for (const item of items) {
      if (!item.compactText || visibleWidth(item.compactText) >= item.w)
        continue;
      item.text = item.compactText;
      item.w = visibleWidth(item.text);
      if (totalW() <= maxW) break;
    }
  }
  while (totalW() > maxW) {
    let target = -1;
    for (let i = 0; i < items.length; i++) {
      if (
        items[i]!.text !== "" &&
        (target === -1 || items[i]!.priority < items[target]!.priority)
      ) {
        target = i;
      }
    }
    if (target === -1) break;
    const others = items.filter(
      (_, i) => i !== target && items[i]!.text !== "",
    );
    const otherW =
      others.reduce((a, it) => a + it.w, 0) + Math.max(0, others.length - 1);
    const avail = maxW - otherW - (others.length > 0 ? 1 : 0);
    if (avail <= visibleWidth(ellipsis)) {
      items[target]!.text = "";
      items[target]!.w = 0;
    } else if (avail < items[target]!.w) {
      const truncate = items[target]!.truncate;
      items[target]!.text = truncate
        ? truncate(items[target]!.text, avail, ellipsis)
        : truncateToWidth(items[target]!.text, avail, ellipsis);
      items[target]!.w = visibleWidth(items[target]!.text);
    } else {
      break;
    }
  }
  return items.filter((it) => it.text !== "").map((it) => it.text);
}

export function isEditorBorderLine(line: string): boolean {
  const plain = stripAnsi(line);
  if (/^─+$/.test(plain)) return true;
  if (/^─*\s*[↑↓]\s+\d+\s+more\s*─*$/.test(plain)) return true;
  return false;
}

export function findBottomBorderIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 1; i--) {
    if (isEditorBorderLine(lines[i]!)) return i;
  }
  return Math.max(0, lines.length - 1);
}

export function padRight(text: string, width: number, ellipsis = ""): string {
  const clipped = truncateToWidth(text, width, ellipsis);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function center(text: string, width: number): string {
  if (width <= 0) return "";
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, "...");
  return `${" ".repeat(Math.floor((width - w) / 2))}${text}`;
}

export const MIN_LEFT_WIDTH = 28;
export const MIN_TIPS_WIDTH = 16;
export const MAX_TIPS_WIDTH = 28;
const COLUMN_GAP = 3;

export function headerColumnWidths(
  innerWidth: number,
  minTipsWidth = MIN_TIPS_WIDTH,
  maxTipsWidth = MAX_TIPS_WIDTH,
  minLeftWidth = MIN_LEFT_WIDTH,
): { leftWidth: number; rightWidth: number; useTips: boolean } {
  if (innerWidth <= 0) {
    return { leftWidth: 0, rightWidth: 0, useTips: false };
  }

  const gap = COLUMN_GAP;
  if (innerWidth < minLeftWidth + gap + minTipsWidth) {
    return { leftWidth: innerWidth, rightWidth: 0, useTips: false };
  }

  let rightWidth = Math.min(
    maxTipsWidth,
    Math.max(minTipsWidth, Math.round(innerWidth * 0.28)),
  );
  let leftWidth = innerWidth - gap - rightWidth;

  if (leftWidth < minLeftWidth) {
    leftWidth = minLeftWidth;
    rightWidth = innerWidth - gap - leftWidth;
  }

  if (leftWidth <= rightWidth) {
    leftWidth = Math.ceil((innerWidth - gap) * 0.65);
    rightWidth = innerWidth - gap - leftWidth;
  }

  if (rightWidth < minTipsWidth || leftWidth < minLeftWidth) {
    return { leftWidth: innerWidth, rightWidth: 0, useTips: false };
  }

  return { leftWidth, rightWidth, useTips: true };
}
