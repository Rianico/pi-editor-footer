import type { ExtensionAPILike } from "./session-orchestrator.js";
import { SessionOrchestrator } from "./session-orchestrator.js";

export const REFRESH_MS = 1000;

export default function (pi: ExtensionAPILike): void {
  const orch = new SessionOrchestrator();
  orch.install(pi);
}
