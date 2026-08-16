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
import { type DetailItem, renderDetail, scroll } from "./detail-render.js";

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
    factory: (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent,
  ): void;
  setWidget(
    key: string,
    content:
      | string[]
      | ((tui: TUI, theme: unknown) => Component & { dispose?(): void })
      | undefined,
    options?: ExtensionWidgetOptionsLike,
  ): void;
}

export interface ExtensionContextLike {
  /** Current run mode: "tui" | "rpc" | "print". */
  mode: string;
  ui: ExtensionUIContextLike;
}

export interface ExtensionAPILike {
  on(event: "session_start", handler: (event: unknown, ctx: ExtensionContextLike) => void): void;
  registerShortcut(
    shortcut: string,
    options: { description?: string; handler: () => void },
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
function createWidget(tui: TUI, _theme: unknown): Component {
  tuiRef = tui;
  return {
    invalidate(): void {
      // No cached render state — nothing to invalidate.
    },
    render(width: number): string[] {
      lastWidth = width;
      if (!currentItem) {
        return [];
      }
      return renderDetail(detailItemOf(currentItem), width, MAX_LINES, scrollOffset);
    },
  };
}

function installWidget(ctx: ExtensionUIContextLike): void {
  ctx.setWidget("pi-skill-desc", createWidget, { placement: "aboveEditor" });
}

function removeWidget(ctx: ExtensionUIContextLike): void {
  ctx.setWidget("pi-skill-desc", undefined);
}

/** Reflect the current highlight in the widget: install, remove, or repaint. */
function updateWidget(ctx: ExtensionUIContextLike): void {
  const hasContent = currentItem !== null && (currentItem.description ?? "").trim() !== "";
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
  const lines = renderDetail(detailItemOf(currentItem), width, MAX_LINES, 0);
  scrollOffset = scroll(scrollOffset, delta, contentLinesFrom(lines), MAX_LINES);
  tuiRef?.requestRender();
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
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new TrackingEditor(tui, theme, keybindings);
      editor.onHighlight = (item) => {
        currentItem = item;
        scrollOffset = 0; // a new candidate restarts the scroll
        updateWidget(ctx.ui);
      };
      return editor;
    });
  });
}
