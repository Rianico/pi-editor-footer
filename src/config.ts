import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type WorkspaceDisplay = "path" | "name";
export type CursorStyle = "block" | "bar" | "underline";
export type IconMode = "auto" | "nerd" | "ascii";

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

export interface TelemetryConfig {
  enabled: boolean;
  tps: boolean;
  ttft: boolean;
  duration: boolean;
  tokens: boolean;
  stalls: boolean;
  cost: boolean;
}

export interface ThemeConfig {
  enabled: boolean;
  workspaceDisplay: WorkspaceDisplay;
  cursorStyle: CursorStyle;
  icons: { mode: IconMode };
  footerSegments: FooterSegments;
  telemetry: TelemetryConfig;
}

export const DEFAULT_CONFIG: ThemeConfig = {
  enabled: true,
  workspaceDisplay: "path",
  cursorStyle: "block",
  icons: { mode: "auto" },
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
  const home = process.env.HOME ?? homedir() ?? ".";
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
  const overrideRec = override as Record<string, unknown>;
  for (const key of Object.keys(overrideRec)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overVal = overrideRec[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overVal === "object" &&
      overVal !== null &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal, overVal);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result as T;
}

export function loadConfig(
  notify?: (msg: string, level: "warning" | "info") => void,
): ThemeConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const config = deepMerge(DEFAULT_CONFIG, parsed);
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
    return config;
  } catch (err) {
    notify?.(
      `config parse error: ${err instanceof Error ? err.message : String(err)}`,
      "warning",
    );
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(patch: Partial<ThemeConfig>): ThemeConfig {
  const current = loadConfig();
  const next = deepMerge(current, patch);
  const path = getConfigPath();
  try {
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    // best-effort
  }
  return next;
}
