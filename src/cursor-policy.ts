import type { TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, renderFakeCursor } from "@earendil-works/pi-tui";

export type CursorStyle = "block" | "bar" | "underline";

const CURSOR_STYLE_SEQUENCES: Partial<Record<CursorStyle, string>> = {
  bar: "\x1b[6 q",
  underline: "\x1b[4 q",
};
const DEFAULT_CURSOR_STYLE_SEQUENCE = "\x1b[0 q";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * pi-tui ≤0.84 inlined the software cursor as a reverse-video pair. 1.3.0 wraps
 * the cursor cell in zero-width fake-cursor APC markers instead and emits
 * CURSOR_MARKER only while focused. Neither shape may be a hard dependency: the
 * fake-cursor pair is not exported from the package root, so derive it from the
 * public renderFakeCursor() seam once.
 */
const LEGACY_SOFTWARE_CURSOR = /\x1b\[7m([\s\S]*?)\x1b\[0m/g;
const FAKE_CURSOR_PROBE = "\u0000";

interface FakeCursorMarkers {
  readonly start: string;
  readonly end: string;
}

const FAKE_CURSOR_MARKERS = deriveFakeCursorMarkers();

function deriveFakeCursorMarkers(): FakeCursorMarkers | undefined {
  // FAKE_CURSOR_START/END are not re-exported by the package root; the public
  // renderFakeCursor() wrapper is the only exported handle on the pair, so invert
  // it with a NUL probe (zero-width markers cannot contain the probe themselves).
  const [start, end, ...rest] = renderFakeCursor(FAKE_CURSOR_PROBE).split(FAKE_CURSOR_PROBE);
  if (start === undefined || end === undefined || rest.length > 0) return undefined;
  if (!start.startsWith("\u001b_") || !end.startsWith("\u001b_")) return undefined;
  return { start, end };
}

function stripFakeCursorMarkers(line: string): string {
  const markers = FAKE_CURSOR_MARKERS;
  if (markers === undefined) return line;
  return line.split(markers.start).join("").split(markers.end).join("");
}

/** Replace the fake-cursor-wrapped cell with the marker (1.3.0 renderer). */
function rewriteFakeCursor(line: string, cursorMarker: string): string | undefined {
  const markers = FAKE_CURSOR_MARKERS;
  if (markers === undefined) return undefined;
  const startIndex = line.indexOf(markers.start);
  if (startIndex === -1) return undefined;
  const cellStart = startIndex + markers.start.length;
  const endIndex = line.indexOf(markers.end, cellStart);
  if (endIndex === -1) {
    // Malformed pair — at least drop the stray zero-width markers.
    return stripFakeCursorMarkers(line);
  }
  const head = line.slice(0, startIndex);
  const cell = line.slice(cellStart, endIndex);
  const tail = stripFakeCursorMarkers(line.slice(endIndex + markers.end.length));
  return `${head}${cursorMarker}${cell}${tail}`;
}

function removeSoftwareCursor(line: string, cursorMarker = ""): string {
  const rewritten = rewriteFakeCursor(line, cursorMarker);
  if (rewritten !== undefined) return rewritten;
  return line.replace(LEGACY_SOFTWARE_CURSOR, (_match, cursor: string) => {
    const replacement = `${cursorMarker}${cursor}`;
    cursorMarker = "";
    return replacement;
  });
}

function configureCursor(tui: TUI, cursorStyle: CursorStyle): void {
  if (cursorStyle === "block") return;
  const setShow = // SAFETY: intentional unsafe cast — validated at runtime
    (tui as unknown as { setShowHardwareCursor?: (v: boolean) => void }).setShowHardwareCursor;
  if (typeof setShow === "function") setShow.call(tui, true);
  const seq = CURSOR_STYLE_SEQUENCES[cursorStyle];
  // SAFETY: intentional unsafe cast — validated at runtime
  const term = (tui as unknown as { terminal?: { write: (s: string) => void } }).terminal;
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
        if (tuiAny.terminal) tuiAny.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
        if (typeof tuiAny.setShowHardwareCursor === "function") tuiAny.setShowHardwareCursor(false);
      } else {
        configureCursor(this.tui, style);
      }
    }
  }

  // Called by TrackingEditor.renderBase — removes software cursor and injects hardware marker when needed
  mapLines(lines: string[], isFocused: boolean): string[] {
    if (this.style === "block") return lines;
    let cursorMarker = this.previewHardwareCursor && !isFocused ? CURSOR_MARKER : "";
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
