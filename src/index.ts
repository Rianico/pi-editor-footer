import type {
	Component,
	EditorComponent,
	EditorTheme,
	KeybindingsManager,
	SelectItem,
	TUI,
} from "@earendil-works/pi-tui";
import type { ThemeLike } from "./model-info.js";
import { SessionOrchestrator } from "./session-orchestrator.js";

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

export const REFRESH_MS = 1000;

export default function (pi: ExtensionAPILike): void {
	const orch = new SessionOrchestrator();
	orch.install(pi);
}

