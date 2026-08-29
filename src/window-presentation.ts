/**
 * Bordered presentation of the detail window.
 *
 * Pure module: takes `renderDetail`'s `[header, ...description]` lines and a
 * theme-like styler, and returns the bordered, styled box:
 *
 *   ┌──────────────────────────────┐
 *   │ name · kind                  │   ← header, theme highlight (accent+bold)
 *   │ description line 1           │   ← description, theme dim
 *   │ description line 2           │
 *   └──────────────────────────────┘
 *
 * Input `lines` must already be wrapped to (width - 4) columns (renderDetail's
 * wrap width); this module adds the two border columns and two border rows.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

/** Styling functions injected from the live theme. */
export interface WindowThemeLike {
	/** Border color function (theme "border"). */
	border(s: string): string;
	/** Header style — the theme's highlight (accent + bold). */
	highlight(s: string): string;
	/** Description style — the theme's dim. */
	dim(s: string): string;
}

/**
 * Wrap `[header, ...body]` in a bordered box. Returns `[]` for empty input
 * (window hidden). Row layout: one `┌─…─┐` border row, the highlighted header
 * row, the dim body rows, and a `└─…─┘` border row. Every row is exactly
 * `width` columns (ANSI-aware padding).
 */
export function decorateWindow(
	lines: string[],
	width: number,
	theme: WindowThemeLike,
): string[] {
	if (lines.length === 0) {
		return [];
	}
	const innerWidth = Math.max(1, width - 4);
	const padTo = (s: string): string =>
		s + " ".repeat(Math.max(0, innerWidth - visibleWidth(s)));

	const header = lines[0] ?? "";
	const body = lines.slice(1);

	const borderRun = theme.border("─".repeat(Math.max(0, width - 2)));
	const match = header.match(/ · (skill|command)/);
	let styledHeader: string;
	if (match?.index === undefined) {
		styledHeader = theme.highlight(header);
	} else {
		const split = match.index + match[0].length;
		const basePart = header.slice(0, split);
		const suffix = header.slice(split);
		styledHeader = suffix
			? theme.highlight(basePart) + theme.dim(suffix)
			: theme.highlight(basePart);
	}
	return [
		`┌${borderRun}┐`,
		`│ ${padTo(styledHeader)} │`,
		...body.map((line) => `│ ${padTo(theme.dim(line))} │`),
		`└${borderRun}┘`,
	];
}
