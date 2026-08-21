import type { TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

export type CursorStyle = "block" | "bar" | "underline";

const CURSOR_STYLE_SEQUENCES: Partial<Record<CursorStyle, string>> = {
  bar: "\x1b[6 q",
  underline: "\x1b[4 q",
};
const DEFAULT_CURSOR_STYLE_SEQUENCE = "\x1b[0 q";

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
    // SAFETY: intentional unsafe cast — validated at runtime
    tui as unknown as { setShowHardwareCursor?: (v: boolean) => void }
  ).setShowHardwareCursor;
  if (typeof setShow === "function") setShow.call(tui, true);
  const seq = CURSOR_STYLE_SEQUENCES[cursorStyle];
  // SAFETY: intentional unsafe cast — validated at runtime
  const term = (tui as unknown as { terminal?: { write: (s: string) => void } })
    .terminal;
  if (seq && term && typeof term.write === "function") term.write(seq);
}

/**
 * CursorPolicy — owns cursor style + hardware cursor juggling behind one seam.
 * Previously tangled inside TrackingEditor; now a deep collaborator injected
 * into the editor. Interface is the test surface.
 */
export class CursorPolicy {
  private style: CursorStyle = "block";
  private previewHardwareCursor = false;

  constructor(private readonly tui: TUI) {}

  getStyle(): CursorStyle {
    return this.style;
  }

  setStyle(style: CursorStyle): void {
    const changed = style !== this.style;
    this.previewHardwareCursor = style !== "block";
    this.style = style;
    if (changed) {
      // SAFETY: intentional unsafe cast — validated at runtime
      const tuiAny = this.tui as unknown as {
        setShowHardwareCursor?: (v: boolean) => void;
        terminal?: { write: (s: string) => void };
      };
      if (style === "block") {
        if (tuiAny.terminal)
          tuiAny.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
        if (typeof tuiAny.setShowHardwareCursor === "function")
          tuiAny.setShowHardwareCursor(false);
      } else {
        configureCursor(this.tui, style);
      }
    }
  }

  // Called by TrackingEditor.renderBase — removes software cursor and injects hardware marker when needed
  mapLines(lines: string[], isFocused: boolean): string[] {
    if (this.style === "block") return lines;
    let cursorMarker =
      this.previewHardwareCursor && !isFocused ? CURSOR_MARKER : "";
    if (isFocused) this.previewHardwareCursor = false;
    return lines.map((line) => {
      const rendered = removeSoftwareCursor(line, cursorMarker);
      if (rendered !== line) cursorMarker = "";
      return rendered;
    });
  }
}

export { configureCursor, removeSoftwareCursor };
export const __testing = { stripAnsi };
