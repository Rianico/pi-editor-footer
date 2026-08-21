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
  footerSegments: FooterSegments;
}

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
};

export function getConfigPath(): string {
  const home = homedir();
  return join(home, ".pi", "agent", "pi-skill-desc.json");
}

function deepMerge<T>(base: T, override: unknown): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return (override as T) ?? base;
  }
  if (
    typeof override !== "object" ||
    override === null ||
    Array.isArray(override)
  ) {
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

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function validate(config: ThemeConfig): ThemeConfig {
  if (
    config.workspaceDisplay !== "path" &&
    config.workspaceDisplay !== "name"
  ) {
    config.workspaceDisplay = DEFAULT_CONFIG.workspaceDisplay;
  }
  if (
    config.cursorStyle !== "block" &&
    config.cursorStyle !== "bar" &&
    config.cursorStyle !== "underline"
  ) {
    config.cursorStyle = DEFAULT_CONFIG.cursorStyle;
  }
  if (
    config.icons.mode !== "auto" &&
    config.icons.mode !== "nerd" &&
    config.icons.mode !== "ascii"
  ) {
    config.icons.mode = DEFAULT_CONFIG.icons.mode;
  }
  if (!isBoolean(config.enabled)) {
    config.enabled = DEFAULT_CONFIG.enabled;
  }
  if (!isBoolean((config as unknown as Record<string, unknown>).contextIconBar)) {
    (config as unknown as Record<string, unknown>).contextIconBar = DEFAULT_CONFIG.contextIconBar;
  }
  const fs = config.footerSegments as unknown as Record<string, unknown>;
  const dfs = DEFAULT_CONFIG.footerSegments as unknown as Record<
    string,
    boolean
  >;
  for (const k of Object.keys(dfs)) {
    if (!isBoolean(fs[k])) fs[k] = dfs[k];
  }
  const t = config.telemetry as unknown as Record<string, unknown>;
  const dt = DEFAULT_CONFIG.telemetry as unknown as Record<string, boolean>;
  for (const k of Object.keys(dt)) {
    if (!isBoolean(t[k])) t[k] = dt[k];
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
  private readonly writeFile: (
    path: string,
    data: string,
    encoding: string,
  ) => void;
  private readonly exists: (path: string) => boolean;
  private readonly mkdirSyncFn: (
    path: string,
    opts: { recursive: boolean },
  ) => void;
  private readonly explicitPath: string | undefined;
  private listeners = new Set<Listener>();

  constructor(deps: ConfigStoreDeps = {}) {
    this.readFile =
      deps.readFile ??
      ((p: string, enc: string) =>
        readFileSync(p, enc as BufferEncoding) as unknown as string);
    this.writeFile =
      deps.writeFile ??
      ((p: string, d: string, enc: string) =>
        writeFileSync(p, d, enc as BufferEncoding));
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
        this.writeFile(
          p,
          JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
          "utf8",
        );
      } catch {
        // best-effort
      }
      return structuredClone(DEFAULT_CONFIG);
    }
    try {
      const raw = this.readFile(p, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const merged = deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
      return validate(merged);
    } catch (err) {
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
      // best-effort
    }
    for (const fn of this.listeners) {
      try {
        fn(merged, prev);
      } catch {
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

export function saveConfig(
  patch: Partial<ThemeConfig> & Record<string, unknown>,
): ThemeConfig {
  return defaultStore.patch(patch);
}
