/**
 * Fail fast when the installed pi packages drift from the pinned ones.
 *
 * #44's entire cost was a stale `node_modules` (pi-tui 0.84.2 / pi-coding-agent 0.85.1
 * installed while the lockfile pinned 1.3.0) presenting as API drift: five tsc errors and
 * four failing suites that looked exactly like a real breaking change. Nothing failed fast,
 * and the signature had to be written down in docs/reference/pi-tui-internals.md instead.
 *
 * This guard is the check that should have fired. Run it in CI before the build and from the
 * pre-push hook; it names the pinned version, the installed version, and the fix.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const WATCHED_PACKAGES = [
  "@earendil-works/pi-tui",
  "@earendil-works/pi-coding-agent",
] as const;

export const FIX_COMMAND = "pnpm install --frozen-lockfile";

export interface Pin {
  readonly name: string;
  readonly pinned: string;
  /** Where the pin came from: `package.json` dependency block, or the lockfile resolution. */
  readonly source: string;
}

export interface Mismatch {
  readonly name: string;
  readonly pinned: string;
  readonly installed: string | null;
  readonly source: string;
}

/** `^1.3.0` / `~1.3.0` / `=1.3.0` / `1.3.0` → `1.3.0`. A caret pin still means "this version". */
export function stripRange(spec: string): string {
  return spec.trim().replace(/^[\^~=]/, "");
}

export function isExact(spec: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(spec.trim());
}

/**
 * Collect the expected version for each watched package.
 *
 * `package.json` wins when it pins an exact version (pi-tui is a devDependency). Otherwise the
 * lockfile's single resolution is the pin — pi-coding-agent is a `*` peer, so the lockfile is
 * the only place its exact version is written down.
 */
export interface ManifestLike {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export function resolvePins(manifest: ManifestLike, lockfile: string): Pin[] {
  const deps = dependencyBlocks(manifest);
  const pins: Pin[] = [];

  for (const name of WATCHED_PACKAGES) {
    const declared = deps[name];
    if (declared !== undefined && isExact(declared)) {
      pins.push({ name, pinned: stripRange(declared), source: "package.json" });
      continue;
    }
    const locked = lockVersions(lockfile, name);
    if (locked.length === 1 && locked[0] !== undefined) {
      pins.push({ name, pinned: locked[0], source: "pnpm-lock.yaml" });
    }
  }

  return pins;
}

function dependencyBlocks(manifest: ManifestLike): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const block of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
    if (block === undefined) continue;
    for (const [key, spec] of Object.entries(block)) merged[key] = spec;
  }
  return merged;
}

/** Every version the lockfile resolves for `name` (snapshot keys look like `'name@1.3.0':`). */
export function lockVersions(lockfile: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s+'?${escaped}@([^\\(:'"]+)'?:\\s*$`, "gm");
  const found = new Set<string>();
  for (const match of lockfile.matchAll(pattern)) {
    const version = match[1];
    if (version !== undefined) found.add(version.trim());
  }
  return [...found];
}

export function diffVersions(pins: Pin[], installed: Record<string, string | null>): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const pin of pins) {
    const actual = installed[pin.name] ?? null;
    if (actual !== pin.pinned) {
      mismatches.push({
        name: pin.name,
        pinned: pin.pinned,
        installed: actual,
        source: pin.source,
      });
    }
  }
  return mismatches;
}

export function formatMismatch(mismatch: Mismatch): string {
  const installed = mismatch.installed ?? "not installed";
  return [
    `${mismatch.name}: installed ${installed}, pinned ${mismatch.pinned} (${mismatch.source})`,
    `  A stale node_modules looks exactly like an API change: fix it before porting anything.`,
    `  Fix: ${FIX_COMMAND}`,
  ].join("\n");
}

export function formatReport(mismatches: Mismatch[]): string {
  if (mismatches.length === 0) {
    return `pinned pi packages match the install (${WATCHED_PACKAGES.join(", ")})`;
  }
  return [
    "installed pi packages do not match the pinned versions:",
    ...mismatches.map(formatMismatch),
  ].join("\n");
}

function installedVersion(name: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join("node_modules", name, "package.json"), "utf8"));
    const version = manifest?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** Exit 1 and name pinned, installed and the fix; exit 0 only when every watched pin matches. */
export function check(root = "."): { code: number; report: string } {
  let manifestText: string;
  try {
    manifestText = readFileSync(join(root, "package.json"), "utf8");
  } catch {
    return { code: 1, report: `cannot read package.json under ${root} — run this from the repo root` };
  }

  let manifest: ManifestLike;
  try {
    manifest = JSON.parse(manifestText) as ManifestLike;
  } catch {
    return { code: 1, report: `package.json under ${root} is not valid JSON` };
  }

  let lockfile = "";
  try {
    lockfile = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  } catch {
    lockfile = "";
  }

  const pins = resolvePins(manifest, lockfile);
  const installed: Record<string, string | null> = {};
  for (const pin of pins) installed[pin.name] = installedVersion(pin.name);

  const mismatches = diffVersions(pins, installed);
  const missing = WATCHED_PACKAGES.filter((name) => !pins.some((pin) => pin.name === name));
  const ambiguous = missing.map(
    (name) => `${name}: no exact pin in package.json and ${lockfile ? "no single lockfile resolution" : "no pnpm-lock.yaml"}`,
  );

  if (ambiguous.length > 0) {
    return { code: 1, report: [...ambiguous, `  Fix: ${FIX_COMMAND}`].join("\n") };
  }
  return { code: mismatches.length === 0 ? 0 : 1, report: formatReport(mismatches) };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, report } = check();
  if (code === 0) {
    console.log(report);
  } else {
    console.error(report);
  }
  process.exitCode = code;
}
