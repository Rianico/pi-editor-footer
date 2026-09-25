import { exportStatsCsv } from "./cache-export.js";
import {
  chartGlyphsForMode,
  GRAPH_VIEWS,
  type GraphView,
  graphViewLabel,
  renderGraphBody,
} from "./cache-graph-view.js";
import { ScrollDialog } from "./cache-scroll-dialog.js";
import { collectCacheSessionMetrics } from "./cache-session-data.js";
import { renderStatsBody } from "./cache-stats-view.js";
import type { CacheSessionMetrics, CacheSessionReader, CacheTheme } from "./cache-types.js";
import type { IconMode } from "./icons.js";

interface CacheExtensionContext {
  hasUI: boolean;
  cwd: string;
  // Structural slice — the runtime pi sessionManager satisfies this.
  sessionManager: unknown;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    custom<T>(
      factory: (
        tui: unknown,
        theme: CacheTheme,
        keybindings: unknown,
        done: (result: T) => void,
      ) => unknown,
      options?: unknown,
    ): Promise<T>;
  };
}

interface CacheConfigSource {
  icons: { mode: IconMode };
}

interface CacheCommandOptions {
  getConfig: () => CacheConfigSource;
}

type CompletionItem = { value: string; label: string; description: string };

interface RegisterCommandApi {
  registerCommand(
    name: string,
    options: {
      description?: string;
      getArgumentCompletions?: (prefix: string) => CompletionItem[] | null;
      handler: (args: string, ctx: CacheExtensionContext) => void | Promise<void>;
    },
  ): void;
}

function normalizeSubcommand(args: string): string {
  return args.trim().toLowerCase();
}

function usageText(): string {
  return "Usage: /cache graph | /cache stats | /cache export";
}

const OVERLAY_OPTIONS = {
  anchor: "center",
  width: "90%",
  maxHeight: "90%",
  margin: 1,
} as const;

const SUBCOMMANDS: CompletionItem[] = [
  { value: "graph", label: "graph", description: "Show cache hit % graph over time" },
  { value: "stats", label: "stats", description: "Show token/cache breakdown table" },
  { value: "export", label: "export", description: "Export stats data to a CSV at project root" },
];

export function registerCacheCommand(pi: RegisterCommandApi, options: CacheCommandOptions): void {
  pi.registerCommand("cache", {
    description: "Show cache hit graph, token/cache statistics, or export CSV",
    getArgumentCompletions(prefix) {
      const filtered = SUBCOMMANDS.filter((item) => item.value.startsWith(prefix.toLowerCase()));
      return filtered.length > 0 ? filtered : SUBCOMMANDS;
    },
    handler: async (args, ctx) => {
      const subcommand = normalizeSubcommand(args);

      if (subcommand !== "graph" && subcommand !== "stats" && subcommand !== "export") {
        ctx.ui.notify(usageText(), "info");
        return;
      }

      // SAFETY: pi seam — runtime sessionManager provides getEntries/getBranch/getSessionName/getSessionFile
      const sessionManager = ctx.sessionManager as CacheSessionReader;
      let metrics: CacheSessionMetrics = collectCacheSessionMetrics(sessionManager);

      if (subcommand === "export") {
        // SAFETY: pi seam — same structural cast as above
        const filePath = await exportStatsCsv(ctx.cwd, ctx.sessionManager as never, metrics);
        ctx.ui.notify(`Exported cache stats CSV to ${filePath}`, "info");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(
          "/cache graph and /cache stats require interactive TUI mode. Use /cache export in non-interactive mode.",
          "info",
        );
        return;
      }

      if (subcommand === "graph") {
        let currentView: GraphView = "per-turn";

        await ctx.ui.custom<void>(
          (_tui, theme, _keybindings, done) =>
            new ScrollDialog(
              theme,
              {
                title: "Context Cache Graph",
                getTitle: () => `Context Cache Graph — ${graphViewLabel(currentView)}`,
                helpText: "1/2/3 view • r refresh • v cycle • ↑/↓ scroll • PgUp/PgDn • q/Esc close",
                renderBody: (innerWidth) =>
                  renderGraphBody(
                    theme,
                    metrics,
                    innerWidth,
                    currentView,
                    chartGlyphsForMode(options.getConfig().icons.mode),
                  ),
                onKey: (data) => {
                  if (data === "r") {
                    metrics = collectCacheSessionMetrics(sessionManager);
                    return true;
                  }
                  if (data === "1") currentView = "per-turn";
                  else if (data === "2") currentView = "cumulative-percent";
                  else if (data === "3") currentView = "cumulative-total";
                  else if (data === "v") {
                    const idx = GRAPH_VIEWS.indexOf(currentView);
                    currentView = GRAPH_VIEWS[(idx + 1) % GRAPH_VIEWS.length]!;
                  } else if (data === "V") {
                    const idx = GRAPH_VIEWS.indexOf(currentView);
                    currentView = GRAPH_VIEWS[(idx + GRAPH_VIEWS.length - 1) % GRAPH_VIEWS.length]!;
                  } else {
                    return false;
                  }
                  return true; // recognised key — re-render even when the view is unchanged
                },
              },
              () => done(undefined),
            ),
          { overlay: true, overlayOptions: OVERLAY_OPTIONS },
        );
        return;
      }

      // stats
      await ctx.ui.custom<void>(
        (_tui, theme, _keybindings, done) =>
          new ScrollDialog(
            theme,
            {
              title: "Context Cache Stats",
              helpText: "r refresh • ↑/↓ scroll • PgUp/PgDn • q/Esc close",
              renderBody: (innerWidth) => renderStatsBody(theme, metrics, innerWidth),
              onKey: (data) => {
                if (data === "r") {
                  metrics = collectCacheSessionMetrics(sessionManager);
                  return true;
                }
                return false;
              },
            },
            () => done(undefined),
          ),
        { overlay: true, overlayOptions: OVERLAY_OPTIONS },
      );
    },
  });
}
