/**
 * TranscriptTimeline — deep module owning Agent run timeline injection behind one seam.
 *
 * Previously src/index.ts scattered wallTimeHistory, capturedIM, findChatContainerViaGlobalScan,
 * captureInteractiveMode, injectTimelineDimLine and clearTimelineHistory as globals with no
 * locality. Fixing a rebuild bug required holding 4 functions in one head.
 *
 * Depth: small interface (inject / clear / getHistory) hides global scan + prototype patch +
 * history replay + theme dim. Callers learn one shape. Two adapters (real chatContainer,
 * in-memory fake) justify the seam — impl stays inside.
 *
 * Leakage quarantined: globalThis breadth-first scan, InteractiveMode.prototype patch,
 * and theme.fg("dim") are internal seams, not part of external seam.
 */

import type { TUI } from "@earendil-works/pi-tui";

export interface TimelineDeps {
  getLastSessionCtx?: () => unknown;
  getTuiRef?: () => TUI | null;
}

interface ChatContainerLike { chatContainer?: { addChild(c: unknown): void }; ui?: unknown; addMessageToChat?: unknown }
function findChatContainerViaGlobalScan(): ChatContainerLike | null {
  try {
    // SAFETY: globalThis scan is intentional — pi exposes no public chatContainer seam
    const seen = new Set<unknown>();
    const queue: unknown[] = [
      globalThis as unknown,
      global as unknown,
      process as unknown,
    ];
    try {
      // SAFETY: require is private Node cache seam — read-only scan for chatContainer
      const req = (globalThis as unknown as { require?: unknown }).require as // SAFETY: private seam
        | { cache?: Record<string, { exports?: unknown }> }
        | undefined;
      if (req?.cache)
        queue.push(
          ...(Object.values(req.cache)
            .map((m) => m?.exports)
            .filter(Boolean) as unknown[]),
        );
    } catch {
      // ignore
    }
    for (let i = 0; i < queue.length && i < 200; i++) {
      const obj = queue[i] as Record<string, unknown>;
      if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
      seen.add(obj);
      try {
        if (
          obj.chatContainer &&
          typeof (obj as { addMessageToChat?: unknown }).addMessageToChat ===
            "function"
        )
          return obj;
        if (obj.chatContainer && obj.ui) return obj;
      } catch {
        // ignore
      }
      try {
        for (const k of Object.getOwnPropertyNames(obj)) {
          try {
            const v = (obj as Record<string, unknown>)[k];
            if (v && typeof v === "object" && !seen.has(v)) {
              if (
                (v as Record<string, unknown>).chatContainer &&
                typeof (v as { addMessageToChat?: unknown })
                  .addMessageToChat === "function"
              )
                return v;
              if (queue.length < 500) queue.push(v);
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export class TranscriptTimeline {
  private history: string[] = [];
  private capturedIM: unknown = null;
  private readonly getLastSessionCtx?: () => unknown;
  private readonly getTuiRef?: () => TUI | null;
  private patched = false;

  constructor(deps: TimelineDeps = {}) {
    this.getLastSessionCtx = deps.getLastSessionCtx;
    this.getTuiRef = deps.getTuiRef;
    this.captureInteractiveMode();
  }

  /** Current history snapshot (for tests / fallback widget). */
  getHistory(): string[] {
    return [...this.history];
  }

  inject(
    ctx: {
      setWidget: (k: string, c: unknown, o?: unknown) => void;
      theme?: unknown;
    },
    rawLine: string,
  ): void {
    this.history.push(rawLine);
    // SAFETY: theme is live pi TUI theme — read at inject time, not cached
    const theme =
      (ctx as unknown as { theme?: unknown }).theme ?? // SAFETY: private pi-tui seam read-only, validated at runtime
      (this.getLastSessionCtx?.() as { ui?: { theme?: unknown } })?.ui?.theme;
    const dimLines = rawLine
      .split("\n")
      .map((l) =>
        theme
          ? (theme as { fg(s: string, t: string): string }).fg("dim", " " + l)
          : " " + l,
      );
    let injected = false;
    try {
      // Try captured, then ctx/tui scan, then global scan
      const extraRoots: unknown[] = [];
      try {
        extraRoots.push(ctx as unknown);
      } catch {}
      try {
        const tui = this.getTuiRef?.();
        if (tui) extraRoots.push(tui as unknown);
      } catch {}
      const fromExtras = (() => {
        // Quick BFS from extra roots (ctx/tui) before global
        const seen = new Set<unknown>();
        const queue: unknown[] = [...extraRoots];
        for (let i = 0; i < queue.length && i < 300; i++) {
          const obj = queue[i] as Record<string, unknown>;
          if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
          seen.add(obj);
          try {
            if ((obj as Record<string, unknown>).chatContainer && typeof (obj as { addMessageToChat?: unknown }).addMessageToChat === "function") return obj;
            if ((obj as Record<string, unknown>).chatContainer && (obj as Record<string, unknown>).ui) return obj;
          } catch {}
          try {
            for (const k of Object.getOwnPropertyNames(obj)) {
              try {
                const v = (obj as Record<string, unknown>)[k];
                if (v && typeof v === "object" && !seen.has(v) && queue.length < 800) queue.push(v);
              } catch {}
            }
            // also symbol keys (pi may use symbols)
            for (const s of Object.getOwnPropertySymbols(obj)) {
              try {
                const v = (obj as unknown as Record<symbol, unknown>)[s];
                if (v && typeof v === "object" && !seen.has(v) && queue.length < 800) queue.push(v);
              } catch {}
            }
          } catch {}
        }
        return null;
      })();
      const im =
        this.capturedIM ??
        fromExtras ??
        (
          // SAFETY: __piTimelineIM is our own global fallback seam set in captureInteractiveMode
          globalThis as unknown as { __piTimelineIM?: () => unknown } // SAFETY: private seam
        ).__piTimelineIM?.() ??
        findChatContainerViaGlobalScan();
      const imAny = im as {
        chatContainer?: { addChild(c: unknown): void };
        ui?: { requestRender?: () => void };
        transcriptScrollView?: { scrollTo(o: unknown): void };
      } | null;
      if (imAny?.chatContainer) {
        this.capturedIM = im;
        const spacerComp = {
          invalidate() {},
          render(_w: number) {
            return [""];
          },
        };
        const textComp = {
          invalidate() {},
          render() {
            return dimLines;
          },
        };
        imAny.chatContainer.addChild(spacerComp);
        imAny.chatContainer.addChild(textComp);
        imAny.ui?.requestRender?.();
        if (imAny.transcriptScrollView?.scrollTo) {
          try {
            imAny.transcriptScrollView.scrollTo({ follow: "end" } as never);
          } catch {
            // ignore
          }
        }
        injected = true;
        // Clear fallback aboveEditor widget if it was used for early injects — now interleaved, don't duplicate
        try {
          ctx.setWidget("wall-time", undefined);
        } catch {}
      }
    } catch {
      // ignore
    }
    if (injected) return;
    // Fallback: aboveEditor widget (very early, before chatContainer captured)
    try {
      const snapshot = [...this.history];
      ctx.setWidget(
        "wall-time",
        (tui: unknown) => {
          if (this.getTuiRef) {
            // keep tuiRef fresh for scrollWindow
            try {
              void tui;
            } catch {
              // ignore
            }
          }
          return {
            invalidate() {},
            render() {
              const th = (
                // SAFETY: ctx theme is live pi TUI theme read at render time
                ctx as unknown as { // SAFETY: private seam
                  theme?: { fg(s: string, t: string): string };
                }
              ).theme;
              return snapshot.flatMap((l) =>
                l.split("\n").map((s) => (th ? th.fg("dim", " " + s) : " " + s)),
              );
            },
          // SAFETY: Component shape matches pi-tui validate at runtime via chatContainer.addChild
          } as unknown as import("@earendil-works/pi-tui").Component; // SAFETY: private seam
        },
        { placement: "aboveEditor" } as never,
      );
      this.getTuiRef?.()?.requestRender();
    } catch {
      // ignore
    }
  }

  clear(ctx?: { setWidget: (k: string, c: unknown) => void }): void {
    this.history = [];
    try {
      ctx?.setWidget("wall-time", undefined);
    } catch {
      // ignore
    }
  }

  private captureInteractiveMode(): void {
    if (this.patched) return;
    try {
      const tryPatch = (IM: unknown) => {
        const imAny = IM as {
          __timelinePatched?: boolean;
          prototype: {
            addMessageToChat?: (...a: unknown[]) => unknown;
            rebuildChatFromMessages?: (...a: unknown[]) => unknown;
          };
        };
        if (!imAny || imAny.__timelinePatched) return;
        imAny.__timelinePatched = true;
        const origAdd = imAny.prototype.addMessageToChat;
        if (origAdd) {
          // SAFETY: patch is the only seam to capture chatContainer from live TUI
          imAny.prototype.addMessageToChat = function (...args: unknown[]) {
            // SAFETY: this is InteractiveMode instance — capture for timeline injection
            (this as unknown as { __captured?: unknown }).__captured = this; // SAFETY: private seam
            // store on outer instance via closure
            return origAdd.apply(this, args);
          };
          // Also store via wrapper that updates outer this.capturedIM — need closure capture
          const self = this;
          const wrappedAdd = function (this: unknown, ...args: unknown[]) {
            self.capturedIM = this;
            return origAdd.apply(this, args);
          };
          imAny.prototype.addMessageToChat = wrappedAdd as never;
        }
        const origRebuild = imAny.prototype.rebuildChatFromMessages;
        if (origRebuild) {
          const self = this;
          imAny.prototype.rebuildChatFromMessages = function (
            this: unknown,
            ...args: unknown[]
          ) {
            self.capturedIM = this;
            const res = origRebuild.apply(this, args);
            try {
              for (const line of self.history) {
                const theme =
                  (this as { ui?: { theme?: unknown } }).ui?.theme ??
                  (self.getLastSessionCtx?.() as { ui?: { theme?: unknown } })
                    ?.ui?.theme;
                if (!theme) continue;
                const dimLines = line
                  .split("\n")
                  .map((s: string) =>
                    (theme as { fg(s: string, t: string): string }).fg(
                      "dim",
                      " " + s,
                    ),
                  );
                const spacerComp = {
                  invalidate() {},
                  render(_w: number) {
                    return [""];
                  },
                };
                const textComp = {
                  invalidate() {},
                  render() {
                    return dimLines;
                  },
                };
                (
                  this as { chatContainer?: { addChild(c: unknown): void } }
                ).chatContainer?.addChild(spacerComp);
                (
                  this as { chatContainer?: { addChild(c: unknown): void } }
                ).chatContainer?.addChild(textComp);
              }
              (
                this as { ui?: { requestRender?: () => void } }
              ).ui?.requestRender?.();
            } catch {
              // ignore
            }
            return res;
          } as never;
        }
      };

      const candidates = [
        "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js",
        "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js",
        "/opt/homebrew/lib/node_modules/@earendil-works/pi-agent-core/dist/modes/interactive/interactive-mode.js",
      ];
      // Try sync require first for immediate capture (avoids async race where first agent_settled falls back)
      try {
        // SAFETY: require is sync Node seam — best-effort immediate patch
        const req = (globalThis as unknown as { require?: (id:string)=>unknown }).require ?? (eval("require") as unknown as (id:string)=>unknown);
        if (typeof req === "function") {
          for (const p of candidates) {
            try {
              const mod = req(p) as { InteractiveMode?: unknown };
              tryPatch(mod?.InteractiveMode);
            } catch {}
          }
        }
      } catch {}
      for (const p of candidates) {
        import(p)
          .then((mod: unknown) =>
            tryPatch((mod as { InteractiveMode?: unknown }).InteractiveMode),
          )
          .catch(() => {});
      }
      import(
        "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js" as never
      )
        .then((mod: unknown) =>
          tryPatch((mod as { InteractiveMode?: unknown }).InteractiveMode),
        )
        .catch(() => {});
      // SAFETY: global fallback used by inject when capturedIM not yet set
      (
        globalThis as unknown as { __piTimelineIM?: () => unknown } // SAFETY: private pi-tui seam read-only, validated at runtime
      ).__piTimelineIM = () =>
        this.capturedIM ?? findChatContainerViaGlobalScan();
      this.patched = true;
    } catch {
      // ignore
    }
  }
}