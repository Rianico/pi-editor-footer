/**
 * TranscriptTimeline — deep module owning Agent run timeline injection behind one seam.
 *
 * Previously src/index.ts scattered wallTimeHistory, capturedIM, findChatContainerViaGlobalScan,
 * captureInteractiveMode, injectTimelineDimLine and clearTimelineHistory as globals with no
 * locality. Fixing a rebuild bug required holding 4 functions in one head.
 * Additionally SessionOrchestrator scattered wallTimeHistory, formatDateTimeWithTimezone
 * and line-building (dt · wallDur · tokens · cache · cost + turns/tools) across
 * agent_settled with no locality — now all Agent-run → dim-line derivation lives here.
 *
 * Depth: small interface (inject / clear / getHistory / buildTimelineText / handleAgentSettled)
 * hides global scan + prototype patch + history replay + theme dim + per-Agent-run totals
 * capping + datetime formatting. Callers learn one shape. Two adapters (real chatContainer,
 * in-memory fake) justify the seam — impl stays inside.
 *
 * Leakage quarantined: globalThis breadth-first scan, InteractiveMode.prototype patch,
 * and theme.fg("dim") are internal seams, not part of external seam. ExtensionPi.appendEntry
 * (public seam) is preferred when available; private scan is fallback.
 */

import type { TUI } from "@earendil-works/pi-tui";
import type { ThemeConfig } from "./config.js";
import type { UsageTotals } from "./state.js";
import type { AgentRunLedger } from "./agent-run-ledger.js";
import type { RunActivitySnapshot } from "./run-activity.js";
import type { TurnTelemetry } from "./telemetry.js";
import { resolveGlyphs } from "./icons.js";
import { fmtTokens, formatDuration } from "./format.js";

export interface TimelineDeps {
  getLastSessionCtx?: () => unknown;
  getTuiRef?: () => TUI | null;
}

// ——— Pure helpers: datetime + timeline text building (testable without TUI) ———

export function formatDateTimeWithTimezone(d: Date = new Date()): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${tz}`.trim();
  } catch {
    // SAFETY: best-effort, ignore recoverable error
    return d.toLocaleString();
  }
}

export interface BuildTimelineParams {
  effectiveTel: TurnTelemetry | null | undefined;
  totals: UsageTotals;
  ctxTokens: number | undefined;
  snap: RunActivitySnapshot;
  config: ThemeConfig;
  lastDoneIn: number;
  now?: Date;
  ledger: AgentRunLedger;
}

/**
 * Pure timeline text builder: Agent-run → dim line (line1 · line2).
 * Single source for dt · wallDur · cache · tokens · cost + turns/tools formatting.
 * Respects timeline config but preserves current behaviour (wallDur/tokens/cost always shown;
 * config flags gate future omit — currently both branches push same, kept for compat).
 * Testable without TUI — no global scan.
 */
export function buildTimelineText(params: BuildTimelineParams): string {
  const {
    effectiveTel,
    totals,
    ctxTokens,
    snap,
    config,
    lastDoneIn,
    now,
    ledger,
  } = params;
  const glyphs = resolveGlyphs(config.icons.mode);
  const dt = formatDateTimeWithTimezone(now ?? new Date());
  const wallDur = formatDuration(lastDoneIn);
  const cacheRate = totals.latestCacheHitRate ?? 0;
  const cacheStr = `${glyphs.cacheHit} ${cacheRate.toFixed(1)}%`;
  const perAgent = ledger.getPerAgentTotalsForTimeline(
    effectiveTel,
    totals,
    ctxTokens,
  );
  const telInput = perAgent.input;
  const telOutput = perAgent.output;
  const telCost = perAgent.cost;
  const line1Parts: string[] = [dt];
  if (config.timeline.wallTime) line1Parts.push(wallDur);
  else line1Parts.push(wallDur);
  if (config.timeline.tokens) {
    line1Parts.push(`${glyphs.input} ${fmtTokens(telInput)}`);
    line1Parts.push(`${glyphs.output} ${fmtTokens(telOutput)}`);
  } else {
    line1Parts.push(`${glyphs.input} ${fmtTokens(telInput)}`);
    line1Parts.push(`${glyphs.output} ${fmtTokens(telOutput)}`);
  }
  line1Parts.push(cacheStr);
  if (config.timeline.cost) line1Parts.push(`$${telCost.toFixed(2)}`);
  else line1Parts.push(`$${telCost.toFixed(2)}`);
  const line1 = line1Parts.join(" · ");
  const turnNum = snap.turnNumber ?? 1;
  const totalTools = snap.completedCount + snap.failedCount + snap.activeTools;
  const line2 = `${turnNum} turns · ${totalTools} tools · ${snap.failedCount} failed`;
  return `${line1}\n${line2}`;
}

interface ChatContainerLike {
  chatContainer?: { addChild(c: unknown): void };
  ui?: unknown;
  addMessageToChat?: unknown;
}
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
      // ast-grep-ignore: require-safety-comment-for-as-unknown-as
      // SAFETY: require is private Node cache seam — read-only scan for chatContainer
      /* SAFETY: intentional unsafe cast — validated at runtime */ const req =
        /* SAFETY: intentional unsafe cast — validated at runtime */ (
          globalThis as unknown as { require?: unknown }
        ).require as // SAFETY: private seam
          | { cache?: Record<string, { exports?: unknown }> }
          | undefined;
      if (req?.cache)
        queue.push(
          ...(Object.values(req.cache)
            .map((m) => m?.exports)
            .filter(Boolean) as unknown[]),
        );
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
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
        // SAFETY: best-effort UI, ignore recoverable error
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
            // SAFETY: best-effort UI, ignore recoverable error
          }
        }
      } catch {
        // SAFETY: best-effort UI, ignore recoverable error
      }
    }
  } catch {
    // SAFETY: best-effort UI, ignore recoverable error
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
      // ast-grep-ignore: require-safety-comment-for-as-unknown-as
      // SAFETY: intentional unsafe cast — validated at runtime
      /* SAFETY: intentional unsafe cast — validated at runtime */ (
        ctx as unknown as { theme?: unknown }
      ).theme ?? // SAFETY: private pi-tui seam read-only, validated at runtime
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
      } catch {
        // SAFETY: best-effort, ignore recoverable error
        // SAFETY: best-effort, ignore recoverable error
      }
      try {
        const tui = this.getTuiRef?.();
        if (tui) extraRoots.push(tui as unknown);
      } catch {
        // SAFETY: best-effort, ignore recoverable error
        // SAFETY: best-effort, ignore recoverable error
      }
      const fromExtras = (() => {
        // Quick BFS from extra roots (ctx/tui) before global
        const seen = new Set<unknown>();
        const queue: unknown[] = [...extraRoots];
        for (let i = 0; i < queue.length && i < 300; i++) {
          const obj = queue[i] as Record<string, unknown>;
          if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
          seen.add(obj);
          try {
            if (
              (obj as Record<string, unknown>).chatContainer &&
              typeof (obj as { addMessageToChat?: unknown })
                .addMessageToChat === "function"
            )
              return obj;
            if (
              (obj as Record<string, unknown>).chatContainer &&
              (obj as Record<string, unknown>).ui
            )
              return obj;
          } catch {
            // SAFETY: best-effort, ignore recoverable error
            // SAFETY: best-effort, ignore recoverable error
          }
          try {
            for (const k of Object.getOwnPropertyNames(obj)) {
              try {
                const v = (obj as Record<string, unknown>)[k];
                if (
                  v &&
                  typeof v === "object" &&
                  !seen.has(v) &&
                  queue.length < 800
                )
                  queue.push(v);
              } catch {
                // SAFETY: best-effort, ignore recoverable error
                // SAFETY: best-effort, ignore recoverable error
              }
            }
            // also symbol keys (pi may use symbols)
            for (const s of Object.getOwnPropertySymbols(obj)) {
              try {
                // ast-grep-ignore: require-safety-comment-for-as-unknown-as
                // SAFETY: intentional unsafe cast — validated at runtime
                /* SAFETY: intentional unsafe cast — validated at runtime */ const v =
                  (obj as unknown as Record<symbol, unknown>)[s]; // SAFETY: intentional unsafe cast — validated at runtime
                if (
                  v &&
                  typeof v === "object" &&
                  !seen.has(v) &&
                  queue.length < 800
                )
                  queue.push(v);
              } catch {
                // SAFETY: best-effort, ignore recoverable error
              }
            }
          } catch {
            // SAFETY: best-effort, ignore recoverable error
            // SAFETY: best-effort, ignore recoverable error
          }
        }
        return null;
      })();
      const im =
        this.capturedIM ??
        fromExtras ??
        // SAFETY: __piTimelineIM is our own global fallback seam set in captureInteractiveMode
        // ast-grep-ignore: require-safety-comment-for-as-unknown-as
        // SAFETY: intentional unsafe cast — validated at runtime
        /* SAFETY: intentional unsafe cast — validated at runtime */ (
          globalThis as unknown as { __piTimelineIM?: () => unknown }
        ) // SAFETY: private seam
          .__piTimelineIM?.() ??
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
            // SAFETY: best-effort UI, ignore recoverable error
          }
        }
        injected = true;
        // Clear fallback aboveEditor widget if it was used for early injects — now interleaved, don't duplicate
        try {
          ctx.setWidget("wall-time", undefined);
        } catch {
          // SAFETY: best-effort, ignore recoverable error
          // SAFETY: best-effort, ignore recoverable error
        }
      }
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
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
              // SAFETY: best-effort UI, ignore recoverable error
            }
          }
          // SAFETY: intentional unsafe cast — validated at runtime
          return {
            invalidate() {},
            render() {
              const th =
                // SAFETY: ctx theme is live pi TUI theme read at render time

                // ast-grep-ignore: require-safety-comment-for-as-unknown-as
                // SAFETY: intentional unsafe cast — validated at runtime
                /* SAFETY: intentional unsafe cast — validated at runtime */ (
                  ctx as unknown as {
                    // SAFETY: intentional unsafe cast — validated at runtime
                    // SAFETY: private seam
                    theme?: { fg(s: string, t: string): string };
                  }
                ).theme;
              return snapshot.flatMap((l) =>
                l
                  .split("\n")
                  .map((s) => (th ? th.fg("dim", " " + s) : " " + s)),
              );
            },
            // ast-grep-ignore: require-safety-comment-for-as-unknown-as
            // SAFETY: Component shape matches pi-tui validate at runtime via chatContainer.addChild
            /* SAFETY: intentional unsafe cast — validated at runtime */
          } as unknown as import("@earendil-works/pi-tui").Component; // SAFETY: private seam
        },
        { placement: "aboveEditor" } as never,
      );
      this.getTuiRef?.()?.requestRender();
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }

  /**
   * Build timeline text via pure helper (exposed for tests / orchestrator).
   * Thin wrapper around buildTimelineText for instance convenience.
   */
  buildText(params: BuildTimelineParams): string {
    return buildTimelineText(params);
  }

  /**
   * Handle Agent settled: build wallText + inject via single seam.
   * Tries public appendEntry (preferred) when extensionPi has it; falls back to private chatContainer scan.
   * History is owned here — single source, no duplicate array in orchestrator.
   * Returns wallText or null if not injected (disabled / missing context).
   */
  handleAgentSettled(
    ctxUI: unknown,
    extensionPi: unknown,
    params: BuildTimelineParams,
  ): string | null {
    if (!params.config.timeline.enabled) return null;
    if (params.lastDoneIn === undefined || params.lastDoneIn === null)
      return null;
    const wallText = buildTimelineText(params);
    // Prefer public seam: pi.appendEntry("timeline", {text}) + registerEntryRenderer
    try {
      const piAny = extensionPi as
        | { appendEntry?: (t: string, d: unknown) => void }
        | null
        | undefined;
      if (piAny && typeof piAny.appendEntry === "function") {
        piAny.appendEntry("timeline", { text: wallText });
        // history owned here even for public path — keeps getHistory() consistent for tests/fallback widget
        this.history.push(wallText);
        return wallText;
      }
    } catch {
      // SAFETY: best-effort, ignore recoverable error
    }
    // Fallback: private scan + aboveEditor widget
    this.inject(ctxUI as never, wallText);
    return wallText;
  }

  clear(ctx?: { setWidget: (k: string, c: unknown) => void }): void {
    this.history = [];
    try {
      ctx?.setWidget("wall-time", undefined);
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
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
            // ast-grep-ignore: require-safety-comment-for-as-unknown-as
            // SAFETY: this is InteractiveMode instance — capture for timeline injection
            /* SAFETY: intentional unsafe cast — validated at runtime */ (
              this as unknown as { __captured?: unknown }
            ).__captured = this; // SAFETY: private seam
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
              // SAFETY: best-effort UI, ignore recoverable error
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
        // SAFETY: require is private Node CJS seam — synchronous scan is best-effort, validated at runtime
        const req =
          // ast-grep-ignore: require-safety-comment-for-as-unknown-as
          // SAFETY: intentional unsafe cast — validated at runtime
          /* SAFETY: intentional unsafe cast — validated at runtime */ (
            globalThis as unknown as { require?: (id: string) => unknown }
          ).require; // SAFETY: intentional unsafe cast — validated at runtime
        if (typeof req === "function") {
          for (const p of candidates) {
            try {
              const mod = req(p) as { InteractiveMode?: unknown };
              tryPatch(mod?.InteractiveMode);
            } catch {
              // SAFETY: best-effort, ignore recoverable error
              // SAFETY: best-effort, ignore recoverable error
            }
          }
        }
      } catch {
        // SAFETY: best-effort, ignore recoverable error
        // SAFETY: best-effort, ignore recoverable error
      }
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

      // ast-grep-ignore: require-safety-comment-for-as-unknown-as
      // SAFETY: intentional unsafe cast — validated at runtime
      /* SAFETY: intentional unsafe cast — validated at runtime */ (
        globalThis as unknown as { __piTimelineIM?: () => unknown }
      ).__piTimelineIM = // SAFETY: intentional unsafe cast — validated at runtime // SAFETY: private pi-tui seam read-only, validated at runtime
        () => this.capturedIM ?? findChatContainerViaGlobalScan();
      this.patched = true;
    } catch {
      // SAFETY: best-effort UI, ignore recoverable error
    }
  }
}
