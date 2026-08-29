/**
 * Pure, TUI-free rendering of the Detail window (ADR-0001).
 *
 * Given a highlighted completion candidate and window state, produces the
 * lines to render in the 5-line detail window above the input box.
 * No pi imports — this is the single testable seam of the extension.
 */

import * as os from "node:os";

export interface DetailItem {
	label: string;
	kind: string;
	description: string;
	path?: string;
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
	const maxOffset =
		capacity === 0 ? 0 : Math.max(0, contentLines.length - capacity);
	const offset = clamp(Math.floor(scrollOffset) || 0, 0, maxOffset);

	const visibleLines = contentLines.slice(offset, offset + capacity);

	// "More content" marker: `...` replaces the last visible content line when
	// there is content remaining BELOW the window (not yet scrolled to the
	// bottom). The header's ` offset/total` marker still carries the totals.
	const hasMoreBelow = offset + visibleLines.length < contentLines.length;
	if (hasMoreBelow && visibleLines.length > 0) {
		visibleLines[visibleLines.length - 1] = "...";
	}
	const overflows = contentLines.length > capacity;
	const base = `${item.label} · ${item.kind}`;
	const marker = overflows ? ` ${offset + 1}/${contentLines.length}` : "";
	const markerLen = marker.length;
	let header: string;
	const rawPath = item.path?.trim() ?? "";
	if (rawPath !== "") {
		const normalized = normalizePath(rawPath);
		const availableForPath = Math.max(0, wrapWidth - base.length - markerLen - 2);
		let pathSeg = "";
		if (availableForPath >= 10) {
			const truncated =
				normalized.length <= availableForPath
					? normalized
					: truncateMiddle(normalized, availableForPath);
			pathSeg = `  ${truncated}`;
		}
		const totalLen = base.length + pathSeg.length + markerLen;
		if (totalLen <= wrapWidth) {
			header = base + pathSeg + marker;
		} else if (pathSeg !== "") {
			const baseWidth = Math.max(0, wrapWidth - pathSeg.length - markerLen);
			header = truncateToWidth(base, baseWidth) + pathSeg + marker;
		} else {
			const nameWidth = Math.max(0, wrapWidth - markerLen);
			header = truncateToWidth(base, nameWidth) + marker;
		}
	} else if (overflows) {
		const nameWidth = Math.max(0, wrapWidth - markerLen);
		header = truncateToWidth(base, nameWidth) + marker;
	} else {
		header = truncateToWidth(base, wrapWidth);
	}

	return [header, ...visibleLines];
}

/**
 * Number of wrapped content lines for a description at a given width
 * (excluding the header). Single source of wrapping truth for both render
 * and scroll clamping — avoids re-parsing the rendered header marker.
 */
export function contentLineCount(
	item: DetailItem | null,
	width: number,
): number {
	if (!item || item.description.trim() === "") {
		return 0;
	}
	return wrapDescription(item.description, Math.max(1, Math.floor(width)))
		.length;
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

export function normalizePath(raw: string): string {
	if (!raw) return raw;
	let p = raw.replace(/\\/g, "/");
	try {
		const cwd = process.cwd().replace(/\\/g, "/");
		if (p === cwd) p = ".";
		else if (p.startsWith(`${cwd}/`)) p = p.slice(cwd.length + 1);
		else {
			const home = os.homedir();
			if (home) {
				const homePosix = home.replace(/\\/g, "/");
				if (p === homePosix) p = "~";
				else if (p.startsWith(`${homePosix}/`)) p = `~${p.slice(homePosix.length)}`;
			}
		}
	} catch {
		// ignore homedir/cwd failures
	}
	return p;
}

export function truncateMiddle(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	if (maxWidth <= 1) return text.slice(0, maxWidth);
	if (maxWidth === 2) return `${text.slice(0, 1)}…`;
	const keep = maxWidth - 1;
	const left = Math.ceil(keep / 2);
	const right = Math.floor(keep / 2);
	return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
