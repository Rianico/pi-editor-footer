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

function validate(config: ThemeConfig): ThemeConfig {
  // workspaceDisplay
  if (
    config.workspaceDisplay !== "path" &&
    config.workspaceDisplay !== "name"
  ) {
    config.workspaceDisplay = DEFAULT_CONFIG.workspaceDisplay;
  }
  // cursorStyle
  if (
    config.cursorStyle !== "block" &&
    config.cursorStyle !== "bar" &&
    config.cursorStyle !== "underline"
  ) {
    config.cursorStyle = DEFAULT_CONFIG.cursorStyle;
  }
  // icons.mode
  if (
    config.icons.mode !== "auto" &&
    config.icons.mode !== "nerd" &&
    config.icons.mode !== "ascii"
  ) {
    config.icons.mode = DEFAULT_CONFIG.icons.mode;
  }
  return config;
}

export function ensureConfigExists(): void {
  const path = getConfigPath();
  if (existsSync(path)) return;
  try {
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
  } catch {
    // best-effort
  }
}

export function loadConfig(): ThemeConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    ensureConfigExists();
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const merged = deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
    return validate(merged);
  } catch (err) {
    console.warn(
      `[pi-skill-desc] config parse error (${path}): ${err instanceof Error ? err.message : String(err)} — using defaults`,
    );
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(
  patch: Partial<ThemeConfig> & Record<string, unknown>,
): ThemeConfig {
  const current = loadConfig();
  const merged = validate(deepMerge(current, patch) as ThemeConfig);
  const path = getConfigPath();
  try {
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");
  } catch {
    // best-effort
  }
  return merged;
}
