import type {
  EditorComponent,
  EditorTheme,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import { TrackingEditor } from "./tracking-editor.js";

/**
 * Minimal local declarations for the slice of pi's ExtensionAPI this extension
 * uses. The authoritative types live in @earendil-works/pi-coding-agent — a
 * runtime dependency provided by pi, intentionally NOT a devDependency here
 * (the scaffold's package.json is shared across implementation tickets).
 * Extend this surface as the extension grows.
 */
export interface ExtensionUIContextLike {
  setEditorComponent(
    factory: (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent,
  ): void;
  setStatus(key: string, text: string | undefined): void;
}

export interface ExtensionContextLike {
  /** Current run mode: "tui" | "rpc" | "print". */
  mode: string;
  ui: ExtensionUIContextLike;
}

export interface ExtensionAPILike {
  on(event: "session_start", handler: (event: unknown, ctx: ExtensionContextLike) => void): void;
}

export default function (pi: ExtensionAPILike): void {
  pi.on("session_start", (_event, ctx) => {
    // Only the interactive TUI has an editor component to replace.
    if (ctx.mode !== "tui") {
      return;
    }
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new TrackingEditor(tui, theme, keybindings);
      // TEMPORARY status-line sink (T2): makes the tracked highlight visible
      // before the detail window exists. T3 replaces this with the widget.
      editor.onHighlight = (item) => {
        ctx.ui.setStatus("pi-skill-desc", item ? item.label : undefined);
      };
      return editor;
    });
  });
}
