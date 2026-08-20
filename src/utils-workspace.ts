// Deprecated — now a thin re-export of path-format. Kept for backward compat
// until header.ts imports path-format directly. New code should import from path-format.
export { formatCwd, basenamePath, truncatePath } from "./path-format.js";
import { basenamePath, formatCwd } from "./path-format.js";

/** Resolve display string for a cwd given a workspaceDisplay mode. */
export function displayCwd(cwd: string, mode: "path" | "name"): string {
  const formatted = formatCwd(cwd);
  return mode === "name" ? basenamePath(formatted) : formatted;
}
