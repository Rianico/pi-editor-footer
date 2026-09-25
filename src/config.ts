/** Typed config for pi-skill-desc theme (admission boundary: validate once). */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type WorkspaceDisplay = "path" | "name";
export type CursorStyle = "block" | "bar" | "underline";
export type IconMode = "auto" | "nerd" | "ascii";

export interface TelemetryConfig {
  enabled: boolean;
  tps: boolean;
  ttft: boolean;
  duration: boolean;
  tokens: boolean;
  stalls: boolean;
  cost: boolean;
}

export interface TimelineConfig {
  enabled: boolean;
  wallTime: boolean;
  tokens: boolean;
  cost: boolean;
}

export interface FooterSegments {
  cwd: boolean;
  sessionName: boolean;
  gitBranch: boolean;
  gitStatus: boolean;
  gitCommit: boolean;
  runtime: boolean;
  context: boolean;
  tokens: boolean;
  cost: boolean;
  extensionStatuses: boolean;
}

export interface ThemeConfig {
  enabled: boolean;
  workspaceDisplay: WorkspaceDisplay;
  cursorStyle: CursorStyle;
  icons: {
    mode: IconMode;
  };
  contextIconBar: boolean;
  telemetry: TelemetryConfig;
  timeline: TimelineConfig;
  footerSegments: FooterSegments;
}

/**
 * Shape anchor for `ThemeConfig`. Kept annotated (not `satisfies`) on purpose:
 * `satisfies` narrows props to literals (e.g. `icons.mode: "auto"`) and breaks
 * consumers that spread-override fields with other valid enum members.
 * The no-orphan-row guarantee lives in the leaf-walk guard test, not the type.
 */
export const DEFAULT_CONFIG: ThemeConfig = {
  enabled: true,
  workspaceDisplay: "path",
  cursorStyle: "block",
  icons: {
    mode: "auto",
  },
  contextIconBar: false,
  footerSegments: {
    cwd: true,
    sessionName: false,
    gitBranch: true,
    gitStatus: true,
    gitCommit: false,
    runtime: true,
    context: true,
    tokens: true,
    cost: true,
    extensionStatuses: true,
  },
  telemetry: {
    enabled: true,
    tps: true,
    ttft: true,
    duration: true,
    tokens: true,
    stalls: true,
    cost: true,
  },
  timeline: {
    enabled: true,
    wallTime: true,
    tokens: true,
    cost: true,
  },
} satisfies ThemeConfig;

export function getConfigPath(): string {
  const home = homedir();
  return join(home, ".pi", "agent", "pi-skill-desc.json");
}

function deepMerge<T>(base: T, override: unknown): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return (override as T) ?? base;
  }
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return base;
  }
  const result = { ...(base as Record<string, unknown>) };
  const rec = override as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    const bv = (base as Record<string, unknown>)[key];
    const ov = rec[key];
    if (
      typeof bv === "object" &&
      bv !== null &&
      !Array.isArray(bv) &&
      typeof ov === "object" &&
      ov !== null &&
      !Array.isArray(ov)
    ) {
      result[key] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      result[key] = ov;
    }
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// Table-driven descriptors — single source for defaults + validation + settings UI
// Adding a flag = one row here (label/tab make it appear in the settings dialog;
// the leaf-walk guard test fails if a config leaf has no row).
// SAFETY: intentional unsafe cast — validated at runtime
// enforces types. No `as unknown as` scattered per field.
// ---------------------------------------------------------------------------

/** Settings dialog tabs; row order within a tab follows table order. */
export type ConfigTab = "general" | "appearance" | "footer" | "telemetry" | "timeline";

export type ConfigDescriptor =
  | {
      path: string;
      kind: "boolean";
      /** Settings row id — defaults to the last path segment. */
      id?: string;
      label: string;
      tab: ConfigTab;
      default: boolean;
    }
  | {
      path: string;
      kind: "enum";
      /** Settings row id — defaults to the last path segment. */
      id?: string;
      label: string;
      tab: ConfigTab;
      /** Display order doubles as the settings cycle order. */
      values: readonly string[];
      /** Optional per-value display text; falls back to the raw value. */
      valueLabels?: Record<string, string>;
      default: string;
    };

/** Single schema table — adding a config leaf is one row. */
export const CONFIG_SCHEMA: readonly ConfigDescriptor[] = [
  // general
  { path: "enabled", kind: "boolean", label: "Enabled", tab: "general", default: true },
  {
    path: "workspaceDisplay",
    kind: "enum",
    values: ["path", "name"],
    valueLabels: { path: "Full path", name: "Name only" },
    label: "Workspace display",
    tab: "general",
    default: "path",
  },
  {
    path: "cursorStyle",
    kind: "enum",
    values: ["block", "bar", "underline"],
    valueLabels: { block: "Block", bar: "Bar", underline: "Underline" },
    label: "Cursor style",
    tab: "general",
    default: "block",
  },
  // appearance
  {
    path: "icons.mode",
    kind: "enum",
    id: "iconMode",
    values: ["auto", "nerd", "ascii"],
    valueLabels: { auto: "Auto", nerd: "Nerd", ascii: "ASCII" },
    label: "Icon mode",
    tab: "appearance",
    default: "auto",
  },
  // footer (display order interleaves the top-level contextIconBar)
  {
    path: "footerSegments.cwd",
    kind: "boolean",
    label: "CWD",
    tab: "footer",
    default: true,
  },
  {
    path: "footerSegments.sessionName",
    kind: "boolean",
    label: "Session name",
    tab: "footer",
    default: false,
  },
  {
    path: "footerSegments.gitBranch",
    kind: "boolean",
    label: "Git branch",
    tab: "footer",
    default: true,
  },
  {
    path: "footerSegments.gitStatus",
    kind: "boolean",
    label: "Git status",
    tab: "footer",
    default: true,
  },
  {
    path: "footerSegments.gitCommit",
    kind: "boolean",
    label: "Git commit (detached)",
    tab: "footer",
    default: false,
  },
  {
    path: "footerSegments.runtime",
    kind: "boolean",
    label: "Runtime",
    tab: "footer",
    default: true,
  },
  {
    path: "footerSegments.context",
    kind: "boolean",
    label: "Context bar",
    tab: "footer",
    default: true,
  },
  {
    path: "contextIconBar",
    kind: "boolean",
    label: "Context icon bar",
    tab: "footer",
    default: false,
  },
  {
    path: "footerSegments.tokens",
    kind: "boolean",
    label: "Tokens",
    tab: "footer",
    default: true,
  },
  {
    path: "footerSegments.cost",
    kind: "boolean",
    label: "Cost",
    tab: "footer",
    default: true,
  },
  {
    path: "footerSegments.extensionStatuses",
    kind: "boolean",
    label: "Extension status line",
    tab: "footer",
    default: true,
  },
  // telemetry
  {
    path: "telemetry.enabled",
    kind: "boolean",
    label: "Enabled",
    tab: "telemetry",
    default: true,
  },
  { path: "telemetry.tps", kind: "boolean", label: "TPS", tab: "telemetry", default: true },
  { path: "telemetry.ttft", kind: "boolean", label: "TTFT", tab: "telemetry", default: true },
  {
    path: "telemetry.duration",
    kind: "boolean",
    label: "Total duration",
    tab: "telemetry",
    default: true,
  },
  {
    path: "telemetry.tokens",
    kind: "boolean",
    label: "Tokens",
    tab: "telemetry",
    default: true,
  },
  {
    path: "telemetry.stalls",
    kind: "boolean",
    label: "Stall details",
    tab: "telemetry",
    default: true,
  },
  {
    path: "telemetry.cost",
    kind: "boolean",
    label: "Cost rate",
    tab: "telemetry",
    default: true,
  },
  // timeline
  {
    path: "timeline.enabled",
    kind: "boolean",
    label: "Timeline enabled",
    tab: "timeline",
    default: true,
  },
  {
    path: "timeline.wallTime",
    kind: "boolean",
    label: "Wall time",
    tab: "timeline",
    default: true,
  },
  {
    path: "timeline.tokens",
    kind: "boolean",
    label: "Tokens",
    tab: "timeline",
    default: true,
  },
  {
    path: "timeline.cost",
    kind: "boolean",
    label: "Cost",
    tab: "timeline",
    default: true,
  },
];

/** Settings row id for a descriptor — explicit `id` wins, else the leaf name. */
export function descriptorRowId(desc: ConfigDescriptor): string {
  return desc.id ?? desc.path.split(".").pop()!;
}

// SAFETY: table-driven config access — path validated against CONFIG_SCHEMA, caller validates via validate()
export function getByPath<T>(obj: unknown, path: string): T | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    // single controlled cast — validation table owns all path access
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as T | undefined;
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function validate(config: ThemeConfig): ThemeConfig {
  for (const desc of CONFIG_SCHEMA) {
    const cur = getByPath(config, desc.path);
    if (desc.kind === "boolean") {
      if (typeof cur !== "boolean") {
        setByPath(config, desc.path, desc.default);
      }
    } else if (desc.kind === "enum") {
      if (!desc.values.includes(cur as string)) {
        setByPath(config, desc.path, desc.default);
      }
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// ConfigStore — deep module owning validation + persistence behind one seam
// ---------------------------------------------------------------------------

export interface ConfigStoreDeps {
  readFile?: (path: string, encoding: string) => string;
  writeFile?: (path: string, data: string, encoding: string) => void;
  exists?: (path: string) => boolean;
  mkdirSync?: (path: string, opts: { recursive: boolean }) => void;
  path?: string;
}

type Listener = (cfg: ThemeConfig, prev: ThemeConfig) => void;

export class ConfigStore {
  private readonly readFile: (path: string, encoding: string) => string;
  private readonly writeFile: (path: string, data: string, encoding: string) => void;
  private readonly exists: (path: string) => boolean;
  private readonly mkdirSyncFn: (path: string, opts: { recursive: boolean }) => void;
  private readonly explicitPath: string | undefined;
  private listeners = new Set<Listener>();

  constructor(deps: ConfigStoreDeps = {}) {
    this.readFile =
      deps.readFile ??
      ((p: string, enc: string) =>
        // SAFETY: intentional unsafe cast — validated at runtime
        readFileSync(p, enc as BufferEncoding) as unknown as string);
    this.writeFile =
      deps.writeFile ??
      ((p: string, d: string, enc: string) => writeFileSync(p, d, enc as BufferEncoding));
    this.exists = deps.exists ?? existsSync;
    this.mkdirSyncFn = deps.mkdirSync ?? mkdirSync;
    this.explicitPath = deps.path;
  }

  getPath(): string {
    return this.explicitPath ?? getConfigPath();
  }

  get(): ThemeConfig {
    const p = this.getPath();
    if (!this.exists(p)) {
      try {
        const dir = join(p, "..");
        if (!this.exists(dir)) this.mkdirSyncFn(dir, { recursive: true });
        this.writeFile(p, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
      } catch {
        // SAFETY: best-effort, ignore recoverable error
      }
      return structuredClone(DEFAULT_CONFIG);
    }
    try {
      const raw = this.readFile(p, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const merged = deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
      return validate(merged);
    } catch (err) {
      // SAFETY: best-effort, ignore recoverable error
      console.warn(
        `[pi-skill-desc] config parse error (${p}): ${err instanceof Error ? err.message : String(err)} — using defaults`,
      );
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  patch(patch: Partial<ThemeConfig> & Record<string, unknown>): ThemeConfig {
    const prev = this.get();
    const merged = validate(deepMerge(prev, patch) as ThemeConfig);
    const p = this.getPath();
    try {
      const dir = join(p, "..");
      if (!this.exists(dir)) this.mkdirSyncFn(dir, { recursive: true });
      this.writeFile(p, JSON.stringify(merged, null, 2) + "\n", "utf8");
    } catch {
      // SAFETY: best-effort, ignore recoverable error
    }
    for (const fn of this.listeners) {
      try {
        fn(merged, prev);
      } catch {
        // SAFETY: best-effort, ignore recoverable error
        // subscriber error should not break store
      }
    }
    return merged;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// Default singleton for backward-compat free functions
const defaultStore = new ConfigStore();

export function ensureConfigExists(): void {
  void defaultStore.get();
}

export function loadConfig(): ThemeConfig {
  return defaultStore.get();
}

export function saveConfig(patch: Partial<ThemeConfig> & Record<string, unknown>): ThemeConfig {
  return defaultStore.patch(patch);
}
