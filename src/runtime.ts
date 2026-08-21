import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 2500;

export interface RuntimeInfo {
  name: string;
  version?: string;
}

interface RuntimeDef {
  name: string;
  files: readonly string[];
  folders?: readonly string[];
  extensions?: readonly string[];
  env?: string;
  versionCommand?: { cmd: string; args?: string[]; pattern?: RegExp };
}

const RUNTIMES: readonly RuntimeDef[] = [
  {
    name: "nodejs",
    files: ["package.json", ".nvmrc", ".node-version"],
    versionCommand: {
      cmd: "node",
      args: ["--version"],
      pattern: /v(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "rust",
    files: ["Cargo.toml"],
    versionCommand: {
      cmd: "rustc",
      args: ["--version"],
      pattern: /rustc\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "go",
    files: ["go.mod"],
    versionCommand: {
      cmd: "go",
      args: ["version"],
      pattern: /go(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "python",
    files: [
      "pyproject.toml",
      "requirements.txt",
      "setup.py",
      "Pipfile",
      ".python-version",
    ],
    versionCommand: {
      cmd: "python3",
      args: ["--version"],
      pattern: /Python\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "ruby",
    files: ["Gemfile", ".ruby-version"],
    versionCommand: {
      cmd: "ruby",
      args: ["--version"],
      pattern: /ruby\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "java",
    files: ["pom.xml", "build.gradle", "build.gradle.kts", ".java-version"],
    versionCommand: {
      cmd: "java",
      args: ["-version"],
      pattern: /version\s+"(\d+\.\d+[.\d]*)"/,
    },
  },
  {
    name: "swift",
    files: ["Package.swift"],
    versionCommand: {
      cmd: "swift",
      args: ["--version"],
      pattern: /Swift\s+(\d+\.\d+)/,
    },
  },
  { name: "kotlin", files: ["build.gradle.kts", "settings.gradle.kts"] },
  { name: "cpp", files: ["CMakeLists.txt", "Makefile"] },
  { name: "c", files: ["Makefile", "CMakeLists.txt"] },
  {
    name: "deno",
    files: ["deno.json", "deno.jsonc", "deno.lock"],
    versionCommand: {
      cmd: "deno",
      args: ["--version"],
      pattern: /deno\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "bun",
    files: ["bun.lock", "bun.lockb"],
    versionCommand: {
      cmd: "bun",
      args: ["--version"],
      pattern: /(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "php",
    files: ["composer.json"],
    versionCommand: {
      cmd: "php",
      args: ["--version"],
      pattern: /PHP\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "haskell",
    files: ["stack.yaml", "cabal.project"],
    versionCommand: {
      cmd: "ghc",
      args: ["--version"],
      pattern: /(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "julia",
    files: ["Project.toml", "Manifest.toml"],
    versionCommand: {
      cmd: "julia",
      args: ["--version"],
      pattern: /julia\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "lua",
    files: ["stylua.toml", ".luarc.json"],
    versionCommand: { cmd: "lua", args: ["-v"], pattern: /Lua\s+(\d+\.\d+)/ },
  },
  {
    name: "elixir",
    files: ["mix.exs"],
    versionCommand: {
      cmd: "elixir",
      args: ["--version"],
      pattern: /Elixir\s+(\d+\.\d+\.\d+)/,
    },
  },
  { name: "erlang", files: ["rebar.config", "erlang.mk"] },
  {
    name: "gleam",
    files: ["gleam.toml"],
    versionCommand: {
      cmd: "gleam",
      args: ["--version"],
      pattern: /gleam\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "crystal",
    files: ["shard.yml"],
    versionCommand: {
      cmd: "crystal",
      args: ["--version"],
      pattern: /Crystal\s+(\d+\.\d+\.\d+)/,
    },
  },
  {
    name: "dart",
    files: ["pubspec.yaml"],
    versionCommand: {
      cmd: "dart",
      args: ["--version"],
      pattern: /Dart\s+SDK\s+version:\s+(\d+\.\d+\.\d+)/,
    },
  },
  { name: "nim", files: ["nim.cfg", ".nimble"] },
  {
    name: "zig",
    files: ["build.zig"],
    versionCommand: {
      cmd: "zig",
      args: ["version"],
      pattern: /(\d+\.\d+\.\d+)/,
    },
  },
  { name: "ocaml", files: [".opam", "dune", "dune-project"] },
  { name: "clojure", files: ["project.clj", "deps.edn"] },
  { name: "scala", files: ["build.sbt"] },
  { name: "perl", files: ["Makefile.PL", "cpanfile"] },
  { name: "r", files: [".Rproj", "DESCRIPTION"] },
  { name: "elm", files: ["elm.json"] },
  { name: "haxe", files: ["haxelib.json"] },
  { name: "vagrant", files: ["Vagrantfile"] },
  {
    name: "terraform",
    files: ["main.tf", "variables.tf"],
    folders: [".terraform"],
  },
  { name: "helm", files: ["Chart.yaml"] },
  { name: "solidity", files: [], extensions: [".sol"] },
  { name: "cobol", files: [], extensions: [".cbl", ".cob"] },
];

interface CacheEntry {
  fingerprint: string;
  runtime: RuntimeInfo | null;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 32;

function fingerprint(cwd: string, def: RuntimeDef): string {
  const parts: string[] = [];
  for (const f of def.files) {
    try {
      const stat = statSync(join(cwd, f));
      parts.push(`${f}:${stat.mtimeMs}`);
    } catch {
      // SAFETY: best-effort, ignore recoverable error
      // SAFETY: best-effort, ignore recoverable error
    }
  }
  if (def.extensions || def.folders) {
    try {
      const entries = readdirSync(cwd);
      parts.push(...entries.slice().sort());
    } catch {
      // SAFETY: best-effort, ignore recoverable error
      // SAFETY: best-effort, ignore recoverable error
    }
  }
  if (def.env && process.env[def.env]) {
    parts.push(`${def.env}=${process.env[def.env]}`);
  }
  return parts.join("\0");
}

function matchesDef(cwd: string, def: RuntimeDef): boolean {
  if (def.env && process.env[def.env]) return true;
  if (def.files.some((f) => existsSync(join(cwd, f)))) return true;
  if (def.folders?.some((f) => existsSync(join(cwd, f)))) return true;
  if (def.extensions) {
    try {
      const entries = readdirSync(cwd);
      if (entries.some((e) => def.extensions!.some((ext) => e.endsWith(ext))))
        return true;
    } catch {
      // SAFETY: best-effort, ignore recoverable error
      // SAFETY: best-effort, ignore recoverable error
    }
  }
  return false;
}

async function fetchVersion(
  def: RuntimeDef,
  cwd: string,
): Promise<string | undefined> {
  if (!def.versionCommand) return undefined;
  try {
    const { stdout } = await execFileAsync(
      def.versionCommand.cmd,
      def.versionCommand.args ?? [],
      {
        cwd,
        timeout: VERSION_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      },
    );
    if (def.versionCommand.pattern) {
      const match = stdout.match(def.versionCommand.pattern);
      return match?.[1];
    }
    return stdout.trim() || undefined;
  } catch {
    // SAFETY: best-effort, ignore recoverable error
    return undefined;
  }
}

export async function readRuntimeInfo(
  cwd: string,
): Promise<RuntimeInfo | null> {
  for (const def of RUNTIMES) {
    if (!matchesDef(cwd, def)) continue;
    const fp = fingerprint(cwd, def);
    const cacheKey = `${cwd}\0${def.name}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.fingerprint === fp) {
      return cached.runtime;
    }

    for (const key of cache.keys()) {
      if (key === cacheKey || key.startsWith(`${cwd}\0`)) cache.delete(key);
    }

    const version = await fetchVersion(def, cwd);
    const info: RuntimeInfo = {
      name: def.name,
      version,
    };
    cache.set(cacheKey, { fingerprint: fp, runtime: info });
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return info;
  }
  return null;
}

export function clearRuntimeCache(): void {
  cache.clear();
}
