/** Pure workspace-path helpers — rebuilt bespoke from tmp/pi-open-tui utils. */

import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve cwd to ~-prefixed form when inside HOME. */
export function formatCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const insideHome =
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!insideHome) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

/** Last path segment (basename) — platform-agnostic. */
export function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Truncate a path to maxLen, keeping head and tail with ... in the middle. */
export function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  if (maxLen <= 3) return "...".slice(0, maxLen);
  const sepChar = path.includes("/") ? "/" : "\\";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 2) return path.slice(0, maxLen - 3) + "...";
  const tail: string[] = [];
  let tailLen = 0;
  for (let i = parts.length - 1; i >= 1; i--) {
    const seg = parts[i]!;
    if (tailLen + seg.length + 4 > maxLen) break;
    tail.unshift(seg);
    tailLen += seg.length + 1;
  }
  const head = parts[0]!;
  const result = `${head}${sepChar}...${sepChar}${tail.join(sepChar)}`;
  return result.length > maxLen ? result.slice(0, maxLen - 3) + "..." : result;
}

/** Resolve display string for a cwd given a workspaceDisplay mode. */
export function displayCwd(cwd: string, mode: "path" | "name"): string {
  const formatted = formatCwd(cwd);
  return mode === "name" ? basenamePath(formatted) : formatted;
}
