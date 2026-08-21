import {
	Editor,
	type Component,
	type EditorComponent,
	type EditorTheme,
	type KeybindingsManager,
	type SelectItem,
	type TUI,
} from "@earendil-works/pi-tui";
import { TrackingEditor } from "./tracking-editor.js";
import { installFooter } from "./footer.js";
import { createInitialState, getUsageTotals } from "./state.js";
import type { FooterState } from "./state.js";
import { TurnTelemetryTracker, formatTurnTelemetry } from "./telemetry.js";
import {
	createRunActivityTracker,
	formatRunActivityTopRight,
} from "./run-activity.js";
import { readGitStatus } from "./git.js";
import { readRuntimeInfo } from "./runtime.js";
import { type DetailItem, renderDetail, scroll } from "./detail-render.js";
import type { ModelInfo, ThemeLike } from "./model-info.js";
import { decorateWindow, type WindowThemeLike } from "./window-presentation.js";
import { loadConfig, saveConfig } from "./config.js";
import type { ThemeConfig } from "./config.js";
import { registerThemeSettingsCommand } from "./theme-settings.js";
import { formatContextBar } from "./footer.js";
import { resolveGlyphs, resolveIconMode } from "./icons.js";
/**
 * Minimal local declarations for the slice of pi's ExtensionAPI this extension
 * uses. The authoritative types live in @earendil-works/pi-coding-agent — a
 * runtime dependency provided by pi, intentionally NOT a devDependency here
 * (the scaffold's package.json is shared across implementation tickets).
 * Extend this surface as the extension grows.
 */
export interface ExtensionWidgetOptionsLike {
	placement?: "aboveEditor" | "belowEditor";
}

export interface ExtensionUIContextLike {
	setEditorComponent(
		factory: (
			tui: TUI,
			theme: EditorTheme,
			keybindings: KeybindingsManager,
		) => EditorComponent,
	): void;
	setWidget(
		key: string,
		content:
			| string[]
			| ((tui: TUI, theme: unknown) => Component & { dispose?(): void })
			| undefined,
		options?: ExtensionWidgetOptionsLike,
	): void;
	/** Live getter for the current theme (used by the border glow at render time). */
	readonly theme: ThemeLike;
	/** Show a transient notification to the user. */
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface ExtensionContextLike {
	/** Current run mode: "tui" | "rpc" | "print". */
	mode: string;
	ui: ExtensionUIContextLike;
	model?: { provider?: string; id?: string; contextWindow?: number };
	thinkingLevel?: string;
}

export interface ExtensionAPILike {
	on(
		event: "session_start",
		handler: (event: unknown, ctx: ExtensionContextLike) => void,
	): void;
	on(
		event: "model_select",
		handler: (event: unknown, ctx: ExtensionContextLike) => void,
	): void;
	on(
		event: "thinking_level_select",
		handler: (event: unknown, ctx: ExtensionContextLike) => void,
	): void;
	on(
		event: "session_shutdown",
		handler: (event: unknown, ctx: ExtensionContextLike) => void,
	): void;
	on(
		event: string,
		handler: (event: unknown, ctx: ExtensionContextLike) => void,
	): void;
	registerShortcut(
		shortcut: string,
		options: { description?: string; handler: () => void },
	): void;
	registerCommand(
		name: string,
		options: {
			description?: string;
			handler: (args: string, ctx: ExtensionContextLike) => void | Promise<void>;
		},
	): void;
}

/** Height cap of the detail window (the user's spec: up to 5 lines). */
const MAX_LINES = 5;

/**
 * Window state shared between the highlight callback, the widget component,
 * and the scroll shortcuts. Kept at module scope: only one editor/window is
 * ever active per session.
 */
let currentItem: SelectItem | null = null;
let scrollOffset = 0;
let lastWidth = 0;
let tuiRef: TUI | null = null;
let shortcutsRegistered = false;
// eslint-disable-next-line prefer-const -- toggled by the /model-info command
let glowEnabled = true;
let footerCleanup: (() => void) | null = null;
let installedEditor: TrackingEditor | null = null;
let lastSessionCtx: ExtensionContextLike | null = null;
let currentConfig: ThemeConfig = loadConfig();
const telemetryTracker = new TurnTelemetryTracker();
const runActivityTracker = createRunActivityTracker();
const REFRESH_MS = 1000;
let liveTickTimer: ReturnType<typeof setInterval> | null = null;
let footerState: FooterState = createInitialState();
let currentModelInfo: ModelInfo = {
	provider: "",
	modelId: "unknown",
	level: "off",
	contextWindow: 0,
};

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

/**
 * Content-line count for the current description, derived from the renderer's
 * own output so it can never drift from T1's wrapping logic:
 * - Overflowing: the header carries a ` offset/total` marker — read `total`.
 * - Fitting: renderDetail at offset 0 returns `[header, ...content]` — count.
 */
function contentLinesFrom(lines: string[]): number {
	if (lines.length === 0) {
		return 0;
	}
	const marker = lines[0].match(/ (\d+)\/(\d+)$/);
	if (marker) {
		return Number.parseInt(marker[2], 10);
	}
	return lines.length - 1;
}

/** The widget component: renders the current window at the TUI's actual width. */
/**
 * The widget component: renders the bordered window at the TUI's actual width,
 * reading the LIVE theme at render time (so theme swaps apply immediately).
 */
function makeWidget(ctx: ExtensionUIContextLike): Component {
	const themeOf = (theme: unknown): WindowThemeLike => {
		const t = theme as {
			fg(color: string, s: string): string;
			bold(s: string): string;
		};
		return {
			border: (s) => t.fg("border", s),
			highlight: (s) => t.fg("accent", t.bold(s)),
			dim: (s) => t.fg("dim", s),
		};
	};
	return {
		invalidate(): void {
			// No cached render state — nothing to invalidate.
		},
		render(width: number): string[] {
			lastWidth = width;
			if (!currentItem) {
				return [];
			}
			// Two border columns on each side: content wraps at width - 4.
			const innerWidth = Math.max(1, width - 4);
			const lines = renderDetail(
				detailItemOf(currentItem),
				innerWidth,
				MAX_LINES,
				scrollOffset,
			);
			return decorateWindow(lines, width, themeOf(ctx.theme));
		},
	};
}

function installWidget(ctx: ExtensionUIContextLike): void {
	ctx.setWidget(
		"pi-skill-desc",
		(tui) => {
			tuiRef = tui;
			return makeWidget(ctx);
		},
		{ placement: "aboveEditor" },
	);
}

function removeWidget(ctx: ExtensionUIContextLike): void {
	ctx.setWidget("pi-skill-desc", undefined);
}

/** Reflect the current highlight in the widget: install, remove, or repaint. */
function updateWidget(ctx: ExtensionUIContextLike): void {
	const hasContent =
		currentItem !== null && (currentItem.description ?? "").trim() !== "";
	if (hasContent) {
		installWidget(ctx);
	} else {
		removeWidget(ctx);
	}
	tuiRef?.requestRender();
}

/** shift+up/down handler: scroll the detail window one line, clamped. */
function scrollWindow(delta: -1 | 1): void {
	if (!currentItem || (currentItem.description ?? "").trim() === "") {
		return; // window not shown — keys stay inert
	}
	const width = lastWidth > 0 ? lastWidth : 80;
	// Match the widget's content width (borders take 4 columns).
	const innerWidth = Math.max(1, width - 4);
	const lines = renderDetail(
		detailItemOf(currentItem),
		innerWidth,
		MAX_LINES,
		0,
	);
	scrollOffset = scroll(scrollOffset, delta, contentLinesFrom(lines), MAX_LINES);
	tuiRef?.requestRender();
}

function modelInfoOf(ctx: ExtensionContextLike): ModelInfo {
	return {
		provider: ctx.model?.provider ?? "",
		modelId: ctx.model?.id ?? "unknown",
		level: ctx.thinkingLevel ?? "off",
		contextWindow: ctx.model?.contextWindow ?? 0,
	};
}

/** Real-time: refresh the top-right run-activity border (turn · duration · tools · failed). */
function refreshTopBorder(): void {
	if (!installedEditor || !lastSessionCtx) return;
	try {
		const theme = lastSessionCtx.ui.theme as unknown as {
			fg(s: string, t: string): string;
		};
		const snap = runActivityTracker.getSnapshot();
		const text = formatRunActivityTopRight(snap, theme as never);
		installedEditor.setTopRightText(text);
	} catch {
		void 0;
	}
}

/** Real-time: refresh the bottom telemetry border from live peek. */
function refreshLiveTelemetry(): void {
	if (!installedEditor || !currentConfig.telemetry.enabled) return;
	try {
		const live = telemetryTracker.peekLive() ?? telemetryTracker.getLastTelemetry();
		if (!live) return;
		const theme = (lastSessionCtx as unknown as { ui?: { theme?: unknown } })?.ui
			?.theme;
		const text = formatTurnTelemetry(
			live,
			theme as never,
			currentConfig.telemetry,
		);
		// Only show live telemetry while a turn is actually running; otherwise keep last final
		if (live.totalMs > 0) installedEditor.setTelemetryText(text);
	} catch {
		void 0;
	}
}

function refreshContextBar(): void {
	if (!installedEditor || !lastSessionCtx) return;
	if (!currentConfig.footerSegments.context) {
		installedEditor.setTopContextText("");
		return;
	}
	try {
		const ctxAny = lastSessionCtx as unknown as {
			getContextUsage?: () => {
				percent?: number;
				tokens?: number;
				contextWindow?: number;
			};
		};
		const usage = ctxAny.getContextUsage?.();
		if (!usage || !usage.contextWindow) {
			installedEditor.setTopContextText("");
			return;
		}
		const theme = lastSessionCtx.ui.theme as unknown as any;
		const glyphs = resolveGlyphs(currentConfig.icons.mode);
		const isAscii = resolveIconMode(currentConfig.icons.mode) === "ascii";
		let cacheHitRate: number | undefined;
		try {
			const totals = getUsageTotals(
				lastSessionCtx as unknown as {
					sessionManager?: {
						getEntries(): {
							type: string;
							message?: {
								role: string;
								usage?: {
									input?: number;
									output?: number;
									cacheRead?: number;
									cacheWrite?: number;
									cost?: { total?: number };
								};
							};
						}[];
					};
				},
			);
			cacheHitRate = totals.latestCacheHitRate;
		} catch {
			void 0;
		}
		const text = formatContextBar(usage, theme as any, glyphs, isAscii, 10, cacheHitRate, currentConfig.contextIconBar);
		installedEditor.setTopContextText(text);
	} catch {
		void 0;
	}
}

function startLiveTick(): void {
	if (liveTickTimer !== null) return;
	liveTickTimer = setInterval(() => {
		if (runActivityTracker.isRunning()) {
			refreshTopBorder();
			refreshLiveTelemetry();
			refreshContextBar();
		} else {
			refreshContextBar();
		}
	}, REFRESH_MS);
	// don't block process exit
	if (
		liveTickTimer &&
		typeof (liveTickTimer as unknown as { unref?: () => void }).unref ===
			"function"
	) {
		(liveTickTimer as unknown as { unref(): void }).unref();
	}
}

function stopLiveTick(): void {
	if (liveTickTimer !== null) {
		clearInterval(liveTickTimer);
		liveTickTimer = null;
	}
}

/**
 * Install the TrackingEditor as the input editor and wire it up.
 *
 * Deferred (setTimeout 0) so it runs after every other extension's SYNCHRONOUS
 * session_start handler: pi allows exactly one custom editor — last writer
 * wins — and other extensions (e.g. the user's model-info-widget) also claim
 * the slot. We must win it, or the highlight tracking never sees the popup.
 */
function installEditor(ctx: ExtensionUIContextLike): void {
	ctx.setEditorComponent((tui, theme, keybindings) => {
		const editor = new TrackingEditor(tui, theme, keybindings, () => ctx.theme);
		installedEditor = editor;
		editor.setModelInfo(currentModelInfo);
		editor.glowEnabled = glowEnabled;
		editor.setCursorStyle(currentConfig.cursorStyle);
		// bottom border left is intentionally empty (cwd removed per user request; cwd lives in footer)
		refreshContextBar();
		editor.onHighlight = (item) => {
			currentItem = item;
			scrollOffset = 0; // a new candidate restarts the scroll
			updateWidget(ctx);
		};
		return editor;
	});
}

/**
 * Watchdog: if another extension takes the editor slot mid-session (their
 * install ran after ours, or a /reload reordered things), take it back.
 * Only fights when the focused component is an input editor (has a Map
 * `actionHandlers`, the CustomEditor duck-type) that is not ours — selectors,
 * dialogs and overlays are left alone.
 */
function ensureEditorOwnership(ctx: ExtensionUIContextLike): void {
	const tui = tuiRef as unknown as {
		getFocusedComponent?: () => unknown;
	} | null;
	const focused = tui?.getFocusedComponent?.();
	if (focused === null || focused === undefined) {
		return;
	}
	const maybeEditor = focused as {
		handleInput?: unknown;
		actionHandlers?: unknown;
	};
	const isInputEditor =
		typeof maybeEditor.handleInput === "function" &&
		maybeEditor.actionHandlers instanceof Map;
	if (isInputEditor && focused !== installedEditor) {
		installEditor(ctx);
	}
}

/**
 * Load-time self-check (ADR-0001 blast radius): the extension reaches into two
 * private pi-tui internals. If pi renames them, warn loudly at load instead of
 * silently showing stale/wrong descriptions.
 */
function assertInternals(): void {
	const missing: string[] = [];
	const proto = Editor.prototype as unknown as Record<string, unknown>;
	if (typeof proto.applyAutocompleteSuggestions !== "function") {
		missing.push("applyAutocompleteSuggestions (method)");
	}
	// autocompleteList is an instance field, not a prototype member; check its
	// presence in the compiled class source. A minifier that renames it would
	// break tracking for real, so the warning firing is the correct outcome.
	if (!Editor.prototype.constructor.toString().includes("autocompleteList")) {
		missing.push("autocompleteList (field)");
	}
	if (missing.length > 0) {
		console.warn(
			`[pi-skill-desc] pi-tui internals changed — highlight tracking may be broken ` +
				`(missing: ${missing.join(", ")}). See docs/adr/0001-tracking-editor-for-skill-descriptions.md.`,
		);
	}
}

assertInternals();

export default function (pi: ExtensionAPILike): void {
	let watchTimer: ReturnType<typeof setInterval> | null = null;
	let deferredInstallTimer: ReturnType<typeof setTimeout> | null = null;
	let headerCleanupInner: (() => void) | null = null;

	// Toggle the border glow + model label (off restores pi's stock border).
	// Replaces model-info-widget's command, which is inert now that we own the
	// editor slot (ADR-0002).
	pi.registerCommand("model-info", {
		description: "Toggle the model label + glow on the input border",
		handler: async (_args, ctx) => {
			glowEnabled = !glowEnabled;
			installedEditor?.setGlowEnabled(glowEnabled);
			ctx.ui.notify(
				`Model info border ${glowEnabled ? "shown" : "hidden"}`,
				"info",
			);
		},
	});
	// Lightweight theme command (identity stub, spec 02) — reads config; full dialog lands later.
	// pi-lsz-theme settings window (like tui-theme)
	registerThemeSettingsCommand(pi, {
		getConfig: () => currentConfig,
		onConfigChanged: (cfg) => {
			const prevEnabled = currentConfig.enabled;
			currentConfig = saveConfig(cfg as unknown as Partial<ThemeConfig>);
			// handle enabled toggle — recover or remove footer immediately
			if (prevEnabled !== currentConfig.enabled) {
				if (!currentConfig.enabled) {
					footerCleanup?.();
					footerCleanup = null;
					(globalThis as unknown as { __footerRender?: () => void }).__footerRender =
						undefined;
				} else if (lastSessionCtx) {
					try {
						footerCleanup?.();
						const ctx2 = lastSessionCtx;
						footerCleanup = installFooter(
							ctx2 as unknown as Parameters<typeof installFooter>[0],
							() => footerState,
							() => currentConfig,
							() => ({
								provider: currentModelInfo.provider,
								model: currentModelInfo.modelId,
								effort: currentModelInfo.level,
							}),
							{
								setRequestRender: (fn) => {
									(
										globalThis as unknown as { __footerRender?: () => void }
									).__footerRender = fn ?? undefined;
								},
								scheduleGitRefresh: () => {
									void (async () => {
										try {
											const cwd =
												(
													ctx2 as unknown as { sessionManager?: { getCwd: () => string } }
												).sessionManager?.getCwd?.() ??
												(ctx2 as unknown as { cwd?: string }).cwd ??
												process.cwd();
											const git = await readGitStatus(cwd);
											footerState = { ...footerState, git } as FooterState;
											refreshContextBar();
											(
												globalThis as unknown as { __footerRender?: () => void }
											).__footerRender?.();
											const runtime = await readRuntimeInfo(cwd);
											footerState = { ...footerState, runtime } as FooterState;
											(
												globalThis as unknown as { __footerRender?: () => void }
											).__footerRender?.();
										} catch (_e) {
											void _e;
										}
									})();
								},
							},
						);
						// immediate population
						void (async () => {
							try {
								const cwd =
									(
										ctx2 as unknown as { sessionManager?: { getCwd: () => string } }
									).sessionManager?.getCwd?.() ??
									(ctx2 as unknown as { cwd?: string }).cwd ??
									process.cwd();
								const git = await readGitStatus(cwd);
								footerState = { ...footerState, git } as FooterState;
								(
									globalThis as unknown as { __footerRender?: () => void }
								).__footerRender?.();
								const runtime = await readRuntimeInfo(cwd);
								footerState = { ...footerState, runtime } as FooterState;
								(
									globalThis as unknown as { __footerRender?: () => void }
								).__footerRender?.();
							} catch (_e) {
								void _e;
							}
						})();
					} catch (_e) {
						void _e;
					}
				}
			}
			installedEditor?.setCursorStyle(currentConfig.cursorStyle);
			refreshContextBar();
			refreshLiveTelemetry();
			tuiRef?.requestRender();
		},
		onOverlayClosed: () => {
			tuiRef?.requestRender();
		},
	});
	pi.on("session_start", (_event, ctx) => {
		// Only the interactive TUI has an editor component to replace.
		if (ctx.mode !== "tui") {
			return;
		}

		if (!shortcutsRegistered) {
			shortcutsRegistered = true;
			pi.registerShortcut("shift+up", {
				description: "Scroll the pi-skill-desc detail window up",
				handler: () => scrollWindow(-1),
			});
			pi.registerShortcut("shift+down", {
				description: "Scroll the pi-skill-desc detail window down",
				handler: () => scrollWindow(1),
			});
			// Fallbacks that work on every terminal (no Kitty/modified-arrow
			// protocol needed): ESC+j / ESC+k are universally distinguishable.
			pi.registerShortcut("alt+j", {
				description: "Scroll the pi-skill-desc detail window up (fallback)",
				handler: () => scrollWindow(-1),
			});
			pi.registerShortcut("alt+k", {
				description: "Scroll the pi-skill-desc detail window down (fallback)",
				handler: () => scrollWindow(1),
			});
		}

		currentModelInfo = modelInfoOf(ctx);
		lastSessionCtx = ctx;

		// Deferred so we win the single editor slot (see installEditor).
		deferredInstallTimer = setTimeout(() => installEditor(ctx.ui), 0);

		// header disabled — first line workspace/hints removed per user request; cwd preserved in footer below input
		if (!currentConfig.enabled) {
			footerCleanup?.();
			footerCleanup = null;
			(globalThis as unknown as { __footerRender?: () => void }).__footerRender =
				undefined;
		} else {
			try {
				// footer
				try {
					footerCleanup?.();
					footerCleanup = installFooter(
						ctx as unknown as Parameters<typeof installFooter>[0],
						() => footerState,
						() => currentConfig,
						() => ({
							provider: currentModelInfo.provider,
							model: currentModelInfo.modelId,
							effort: currentModelInfo.level,
						}),
						{
							setRequestRender: (fn) => {
								(
									globalThis as unknown as { __footerRender?: () => void }
								).__footerRender = fn ?? undefined;
							},
							scheduleGitRefresh: () => {
								void (async () => {
									try {
										const cwd =
											(
												ctx as unknown as { sessionManager?: { getCwd: () => string } }
											).sessionManager?.getCwd?.() ??
											(ctx as unknown as { cwd?: string }).cwd ??
											process.cwd();
										const git = await readGitStatus(cwd);
										footerState = { ...footerState, git } as FooterState;
										// bottom border left: location + git (right of cwd)
										refreshContextBar();
										(
											globalThis as unknown as { __footerRender?: () => void }
										).__footerRender?.();
										const runtime = await readRuntimeInfo(cwd);
										footerState = { ...footerState, runtime } as FooterState;
										(
											globalThis as unknown as { __footerRender?: () => void }
										).__footerRender?.();
									} catch (_e) {
										void _e;
									}
								})();
							},
						},
					);
				} catch (_e) {
					void _e;
				}
				// initial git/runtime population so footer isn't empty at startup (onBranchChange only fires on change)
				void (async () => {
					try {
						const cwd =
							(
								ctx as unknown as { sessionManager?: { getCwd: () => string } }
							).sessionManager?.getCwd?.() ??
							(ctx as unknown as { cwd?: string }).cwd ??
							process.cwd();
						const git = await readGitStatus(cwd);
						footerState = { ...footerState, git } as FooterState;
						refreshContextBar();
						(
							globalThis as unknown as { __footerRender?: () => void }
						).__footerRender?.();
						const runtime = await readRuntimeInfo(cwd);
						footerState = { ...footerState, runtime } as FooterState;
						(
							globalThis as unknown as { __footerRender?: () => void }
						).__footerRender?.();
					} catch (_e) {
						void _e;
					}
				})();
				installedEditor?.setCursorStyle(currentConfig.cursorStyle);
				refreshContextBar();
			} catch (_e) {
				void _e;
			}
		} // end if (!enabled) else

		// Re-arm the ownership watchdog with this session's ctx.
		if (watchTimer !== null) {
			clearInterval(watchTimer);
		}
		watchTimer = setInterval(() => ensureEditorOwnership(ctx.ui), REFRESH_MS);
	});

	// Teardown: pi emits session_shutdown BEFORE invalidating this runner (and
	// before re-evaluating the module on /reload). Any timer that captured this
	// session's ctx must be dead before then — otherwise its next tick hits the
	// stale `ctx.ui` getter and assertActive() throws, crashing the process.
	pi.on("session_shutdown", () => {
		stopLiveTick();
		runActivityTracker.reset();
		installedEditor?.setTopRightText("");
		// keep last telemetry visible until next turn — clear only the live tick
		lastSessionCtx = null;
		headerCleanupInner?.();
		headerCleanupInner = null;
		footerCleanup?.();
		footerCleanup = null;
		if (deferredInstallTimer !== null) {
			clearTimeout(deferredInstallTimer);
			deferredInstallTimer = null;
		}
		if (watchTimer !== null) {
			clearInterval(watchTimer);
			watchTimer = null;
		}
	});

	// telemetry + run-activity — real-time top-right and bottom borders
	// top: <turn> · <turn_duration> · <tool calling number> · <failed tool calling number>
	// bottom: live TPS/TTFT/duration/token/cost from peekLive()
	const getToolCallId = (e: unknown): string => {
		const ev = e as Record<string, unknown>;
		return (
			(ev.toolCallId as string) ??
			(ev.toolCallID as string) ??
			((ev.toolCall as Record<string, unknown>)?.id as string) ??
			""
		);
	};
	const getToolIsError = (e: unknown): boolean => {
		const ev = e as Record<string, unknown>;
		if (typeof ev.isError === "boolean") return ev.isError;
		if (typeof ev.success === "boolean") return !ev.success;
		const result = ev.result as Record<string, unknown> | undefined;
		if (result && typeof result.isError === "boolean") return result.isError;
		return false;
	};
	const refreshAllLive = (): void => {
		refreshTopBorder();
		refreshLiveTelemetry();
		refreshContextBar();
	};

	pi.on("agent_start", (e) => {
		telemetryTracker.handle(e as never);
		runActivityTracker.startRun();
		startLiveTick();
		refreshAllLive();
	});
	pi.on("turn_start", (e) => {
		telemetryTracker.handle(e as never);
		const turnIdx = (e as { turnIndex?: number })?.turnIndex ?? 0;
		runActivityTracker.startTurn(turnIdx);
		startLiveTick();
		refreshAllLive();
	});
	// pi-atelier uses before_provider_request to mark request start for TTFT; pi-coding-agent emits "before_provider_request" — handle if present, else message_start covers it
	pi.on("before_provider_request", () => {
		// treat as request start for live TTFT estimate — tracker already handles message lifecycle, just refresh
		refreshAllLive();
	});
	pi.on("message_start", (e) => {
		telemetryTracker.handle(e as never);
		refreshAllLive();
	});
	pi.on("message_update", (e) => {
		telemetryTracker.handle(e as never);
		refreshAllLive();
	});
	pi.on("message_end", (e) => {
		telemetryTracker.handle(e as never);
		refreshAllLive();
	});
	pi.on("tool_execution_start", (e) => {
		telemetryTracker.handle(e as never);
		runActivityTracker.startTool(getToolCallId(e));
		refreshAllLive();
	});
	pi.on("tool_execution_end", (e) => {
		runActivityTracker.finishTool(getToolCallId(e), getToolIsError(e));
		refreshAllLive();
	});
	// fallback for runtimes that emit "tool_result" instead of "tool_execution_end"
	pi.on("tool_result", (e) => {
		// avoid double-count if tool_execution_end already handled: finishTool is idempotent via Map
		runActivityTracker.finishTool(getToolCallId(e), getToolIsError(e));
		refreshAllLive();
	});
	pi.on("turn_end", (e) => {
		telemetryTracker.handle(e as never);
		refreshAllLive();
	});
	pi.on("agent_settled", (e, c) => {
		const tel = telemetryTracker.handle(e as never);
		runActivityTracker.settle();
		stopLiveTick();
		// final settled telemetry overwrites live peek with authoritative totals
		if (tel && installedEditor && currentConfig.telemetry.enabled) {
			try {
				const themeArg = (c as unknown as { ui?: { theme?: unknown } })?.ui?.theme;
				const text = formatTurnTelemetry(
					tel,
					themeArg as never,
					currentConfig.telemetry,
				);
				installedEditor.setTelemetryText(text);
			} catch (_e) {
				void _e;
			}
		}
		// settled top border stays showing final turn stats until next run
		refreshTopBorder();
	});

	// Keep the border label/glow current when the model or thinking level changes.
	pi.on("model_select", (_event, ctx) => {
		if (ctx.mode !== "tui") {
			return;
		}
		currentModelInfo = modelInfoOf(ctx);
		lastSessionCtx = ctx;
		installedEditor?.setModelInfo(currentModelInfo);
	});
	pi.on("thinking_level_select", (_event, ctx) => {
		if (ctx.mode !== "tui") {
			return;
		}
		currentModelInfo = modelInfoOf(ctx);
		lastSessionCtx = ctx;
		installedEditor?.setModelInfo(currentModelInfo);
	});
}
