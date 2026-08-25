/**
 * DetailChrome — deep module owning the whole Detail-window flow behind one seam.
 *
 * Previously the Highlight → Detail window flow was fragmented: TrackingEditor
 * observed the Candidate highlight, src/index.ts held widget state
 * (currentItem/scrollOffset/lastWidth), scroll math, and header-marker
 * re-parsing (contentLinesFrom); src/detail-render.ts owned wrapping;
 * src/window-presentation.ts owned the border. Fixing a wrapping bug required
 * holding 3 modules in one head — no locality.
 *
 * Depth: small interface (setItem / getItem / scrollBy / render) hides scroll
 * offset, width, MAX_LINES, wrapping, border, and header-marker parsing inside.
 * detail-render + window-presentation are INTERNAL seams, not part of the
 * interface. One place to learn — one place to test, no TUI needed.
 */
import type { SelectItem } from "@earendil-works/pi-tui";
import {
  contentLineCount,
  type DetailItem,
  renderDetail,
  scroll,
} from "./detail-render.js";
import { decorateWindow, type WindowThemeLike } from "./window-presentation.js";

/** Height cap of the detail window (the user's spec: up to 5 lines). */
export const MAX_LINES = 5;

/** Kind tag for the header — derived from the candidate's command prefix. */
function kindOf(value: string): string {
  return value.startsWith("skill:") ? "skill" : "command";
}

function detailItemOf(item: SelectItem): DetailItem {
  return {
    label: item.label,
    kind: kindOf(item.value),
    description: item.description ?? "",
  };
}

/** Structural subset of pi's Theme used to build the window theme at render time. */
export interface RawThemeLike {
  fg(color: string, s: string): string;
  bold(s: string): string;
}

export class DetailChrome {
  private item: SelectItem | null = null;
  private scrollOffset = 0;
  private lastWidth = 0;
  readonly maxLines: number;

  constructor(maxLines: number = MAX_LINES) {
    this.maxLines = Math.max(1, Math.floor(maxLines));
  }

  /** New candidate — restarts the scroll. Null hides the window. */
  setItem(item: SelectItem | null): void {
    this.item = item;
    this.scrollOffset = 0;
  }

  getItem(): SelectItem | null {
    return this.item;
  }

  /** Current scroll offset (for tests / reading). */
  getScrollOffset(): number {
    return this.scrollOffset;
  }

  /** Whether the current item has a non-empty description (widget install decision). */
  hasContent(): boolean {
    return this.item !== null && (this.item.description ?? "").trim() !== "";
  }

  /**
   * Move the scroll one line, clamped. No-op when the window is hidden or the
   * description fits. Returns the resulting offset.
   */
  scrollBy(delta: -1 | 1): number {
    const item = this.item;
    if (!item || (item.description ?? "").trim() === "") {
      return this.scrollOffset;
    }
    const width = this.lastWidth > 0 ? this.lastWidth : 80;
    const innerWidth = Math.max(1, width - 4);
    this.scrollOffset = scroll(
      this.scrollOffset,
      delta,
      contentLineCount(detailItemOf(item), innerWidth),
      this.maxLines,
    );
    return this.scrollOffset;
  }

  /**
   * Rendered bordered window at `width`. Returns `[]` when hidden (window
   * not shown). Reads the LIVE theme at render time so theme swaps apply
   * immediately.
   */
  render(width: number, theme: unknown): string[] {
    this.lastWidth = width;
    const item = this.item;
    if (!item || (item.description ?? "").trim() === "") {
      return [];
    }
    const t = theme as RawThemeLike;
    const windowTheme: WindowThemeLike = {
      border: (s) => t.fg("border", s),
      highlight: (s) => t.fg("accent", t.bold(s)),
      dim: (s) => t.fg("dim", s),
    };
    const innerWidth = Math.max(1, width - 4);
    const lines = renderDetail(
      detailItemOf(item),
      innerWidth,
      this.maxLines,
      this.scrollOffset,
    );
    return decorateWindow(lines, width, windowTheme);
  }
}
