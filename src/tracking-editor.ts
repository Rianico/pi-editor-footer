import {
	Editor,
	type EditorOptions,
	type EditorTheme,
	type SelectItem,
	type SelectList,
	type TUI,
} from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	applyModelInfo,
	type ModelInfo,
	type ThemeLike,
} from "./model-info.js";

export type CursorStyle = "block" | "bar" | "underline";

const CURSOR_STYLE_SEQUENCES: Partial<Record<CursorStyle, string>> = {
	bar: "\x1b[6 q",
	underline: "\x1b[4 q",
};
const DEFAULT_CURSOR_STYLE_SEQUENCE = "\x1b[0 q";
const CURSOR_MARKER = "\x1b[7m";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function removeSoftwareCursor(line: string, cursorMarker = ""): string {
	return line.replace(
		/\x1b\[7m([\s\S]*?)\x1b\[0m/g,
		(_match, cursor: string) => {
			const replacement = `${cursorMarker}${cursor}`;
			cursorMarker = "";
			return replacement;
		},
	);
}

function configureCursor(tui: TUI, cursorStyle: CursorStyle): void {
	if (cursorStyle === "block") return;
	const setShow = (
		tui as unknown as { setShowHardwareCursor?: (v: boolean) => void }
	).setShowHardwareCursor;
	if (typeof setShow === "function") setShow.call(tui, true);
	const seq = CURSOR_STYLE_SEQUENCES[cursorStyle];
	const term = (tui as unknown as { terminal?: { write: (s: string) => void } })
		.terminal;
	if (seq && term && typeof term.write === "function") term.write(seq);
}

function isPlainBorder(line: string): boolean {
	return /^─+$/.test(stripAnsi(line));
}
function isScrollBorder(line: string): boolean {
	return /^─── [↑↓] \d+ more/.test(stripAnsi(line));
}
function isBorderLine(line: string): boolean {
	const plain = stripAnsi(line);
	return /^─+$/.test(plain) || /^─── [↑↓] \d+ more/.test(plain);
}

/**
 * Embed telemetry text right-aligned on the bottom border line.
 * Left dashes are glow-colored, telemetry keeps its own ANSI colors.
 */
function embedTelemetry(
	lines: string[],
	width: number,
	telemetryText: string,
	getGlow: (s: string) => string,
): string[] {
	if (!telemetryText || lines.length === 0) return lines;
	const tWidth = visibleWidth(telemetryText);
	if (tWidth <= 0) return lines;
	// Find bottom border index (last border-like line)
	let bottomIdx = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (isBorderLine(lines[i] ?? "")) {
			bottomIdx = i;
			break;
		}
	}
	if (bottomIdx === -1) return lines;

	// Truncate telemetry if too wide (reserve 2 pad spaces + 1 right dash min)
	const maxTelemetryWidth = Math.max(0, width - 3);
	let displayText = telemetryText;
	let displayWidth = tWidth;
	if (tWidth > maxTelemetryWidth) {
		displayText = truncateToWidth(telemetryText, maxTelemetryWidth, "");
		displayWidth = visibleWidth(displayText);
	}
	const pad = " ";
	const rightDash = 1;
	const leftDash = Math.max(0, width - displayWidth - 2 - rightDash);
	// Build bottom line: left glow dashes + pad + telemetry + pad + right glow dash
	const embedded =
		getGlow("─".repeat(leftDash)) +
		pad +
		displayText +
		pad +
		getGlow("─".repeat(rightDash));
	// Ensure visible width equals requested width (truncate if ANSI miscount)
	const result = [...lines];
	result[bottomIdx] = truncateToWidth(embedded, width, "");
	// truncateToWidth strips? We used it without theme; need to ensure we keep ANSI.
	// Actually truncateToWidth from pi-tui handles ANSI; our embedded already ANSI, but we passed without theme fg for ellipsis.
	// If truncation happened above, we already handled. So just assign embedded; ensure width.
	// Use visibleWidth to pad if needed? Embedded already width-exact by construction.
	// For safety, if visibleWidth != width due to rounding, pad/truncate via visibleWidth
	if (visibleWidth(embedded) !== width) {
		// Fallback: truncate/pad using visibleWidth
		result[bottomIdx] = embedded;
	}
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
	if (rightW > maxRight) displayRight = truncateToWidth(rightText, maxRight, "");
	const leftSegment = displayLeft
		? `${getGlow("─")}${" "}${displayLeft}${" "}`
		: getGlow("─");
	const rightSegment = displayRight
		? `${" "}${displayRight}${" "}${getGlow("─")}`
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

interface KeybindingsLike {
	matches(data: string, keybinding: string): boolean;
}

interface AutocompleteSuggestionsLike {
	prefix: string;
	items: SelectItem[];
}

interface EditorInternals {
	autocompleteList?: SelectList;
	applyAutocompleteSuggestions?: (
		suggestions: AutocompleteSuggestionsLike,
		state: "force" | "regular",
	) => void;
}

export class TrackingEditor extends Editor {
	keybindings: KeybindingsLike;
	actionHandlers = new Map<string, () => void>();

	onEscape?: () => void;
	onCtrlD?: () => void;
	onPasteImage?: () => void;
	onExtensionShortcut?: (data: string) => boolean;

	onHighlight?: (item: SelectItem | null) => void;

	glowEnabled = true;

	private lastWiredList?: SelectList;

	private modelInfo: ModelInfo = {
		provider: "",
		modelId: "unknown",
		level: "off",
		contextWindow: 0,
	};

	private readonly getLiveTheme: () => ThemeLike;

	private cursorStyle: CursorStyle = "block";
	private telemetryText = "";
	private bottomLeftText = "";
	private previewHardwareCursor = false;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsLike,
		getLiveTheme: () => ThemeLike,
		options?: EditorOptions,
	) {
		super(tui, theme, options);
		this.keybindings = keybindings;
		this.getLiveTheme = getLiveTheme;
		this.patchApplyAutocompleteSuggestions();
	}

	onAction(action: string, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	setModelInfo(info: ModelInfo): void {
		this.modelInfo = info;
		this.tui.requestRender();
	}

	setGlowEnabled(enabled: boolean): void {
		this.glowEnabled = enabled;
		this.tui.requestRender();
	}

	setCursorStyle(style: CursorStyle): void {
		const changed = style !== this.cursorStyle;
		this.previewHardwareCursor = style !== "block";
		this.cursorStyle = style;
		if (changed) {
			const tuiAny = this.tui as unknown as {
				setShowHardwareCursor?: (v: boolean) => void;
				terminal?: { write: (s: string) => void };
			};
			if (style === "block") {
				if (tuiAny.terminal) tuiAny.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
				if (typeof tuiAny.setShowHardwareCursor === "function")
					tuiAny.setShowHardwareCursor(false);
			} else {
				configureCursor(this.tui, style);
			}
		}
		this.tui.requestRender();
	}

	getCursorStyle(): CursorStyle {
		return this.cursorStyle;
	}

	setTelemetryText(text: string): void {
		this.telemetryText = text;
		this.tui.requestRender();
	}

	setBottomLeftText(text: string): void {
		this.bottomLeftText = text;
		this.tui.requestRender();
	}

	getBottomLeftText(): string {
		return this.bottomLeftText;
	}

	getTelemetryText(): string {
		return this.telemetryText;
	}

	private patchApplyAutocompleteSuggestions(): void {
		const internals = this as unknown as EditorInternals;
		const original = internals.applyAutocompleteSuggestions;
		if (typeof original !== "function") {
			console.warn(
				"[pi-skill-desc] pi-tui internals changed: `applyAutocompleteSuggestions` not found on Editor — highlight tracking disabled.",
			);
			return;
		}
		internals.applyAutocompleteSuggestions = (suggestions, state) => {
			original.call(this, suggestions, state);
			this.syncHighlight();
		};
	}

	private syncHighlight(): void {
		const list = this.currentAutocompleteList();
		if (!list) {
			this.onHighlight?.(null);
			return;
		}
		if (list !== this.lastWiredList) {
			this.lastWiredList = list;
			list.onSelectionChange = (item) => this.onHighlight?.(item);
		}
		this.onHighlight?.(list.getSelectedItem());
	}

	private currentAutocompleteList(): SelectList | undefined {
		return (this as unknown as EditorInternals).autocompleteList;
	}

	private renderBase(width: number): string[] {
		const lines = super.render(width);
		if (this.cursorStyle === "block") return lines;
		let cursorMarker =
			this.previewHardwareCursor &&
			!(this as unknown as { focused?: boolean }).focused
				? CURSOR_MARKER
				: "";
		if ((this as unknown as { focused?: boolean }).focused)
			this.previewHardwareCursor = false;
		return lines.map((line) => {
			const rendered = removeSoftwareCursor(line, cursorMarker);
			if (rendered !== line) cursorMarker = "";
			return rendered;
		});
	}

	override render(width: number): string[] {
		let lines = this.renderBase(width);
		if (lines.length === 0) return lines;

		// Apply model-info glow/label on top (and bottom recolor) if enabled
		if (this.glowEnabled) {
			lines = applyModelInfo(lines, width, this.getLiveTheme(), this.modelInfo);
		}

		// Embed telemetry on bottom border (theme-respecting, right-aligned, truncated)
		// Embed location (left) and telemetry (right) on bottom border
		if (this.bottomLeftText || this.telemetryText) {
			const theme = this.getLiveTheme();
			const glow = (s: string): string => {
				try {
					const maybeGlow = (
						theme as unknown as {
							getThinkingBorderColor?: (l: string) => (s: string) => string;
						}
					).getThinkingBorderColor;
					if (typeof maybeGlow === "function")
						return maybeGlow.call(theme, this.modelInfo.level)(s);
				} catch (_err) {
					void _err;
				}
				return s;
			};
			lines = embedBottomBorder(
				lines,
				width,
				this.bottomLeftText,
				this.telemetryText,
				glow,
			);
		}

		return lines;
	}

	override handleInput(data: string): void {
		if (this.onExtensionShortcut?.(data)) {
			return;
		}
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			super.handleInput(data);
			this.syncHighlight();
			return;
		}
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
		}
		if (
			this.keybindings.matches(data, "tui.editor.historyPrevious") ||
			this.keybindings.matches(data, "tui.editor.historyNext")
		) {
			super.handleInput(data);
			return;
		}
		for (const [action, handler] of this.actionHandlers) {
			if (
				action !== "app.interrupt" &&
				action !== "app.exit" &&
				this.keybindings.matches(data, action)
			) {
				handler();
				return;
			}
		}
		super.handleInput(data);
		this.syncHighlight();
	}
}
