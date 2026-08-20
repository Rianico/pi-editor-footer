export function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${s}s`;
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}h ${m}m ${s}s`;
}

export function formatModelLabel(
  model: { provider?: string; id?: string } | null | undefined,
): string {
  if (!model?.id) return "no-model";
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export function formatProviderLabel(provider: string | undefined): string {
  if (!provider) return "Unknown";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function formatThinkingLabel(level: string): string {
  if (level === "off") return "thinking off";
  return `${level} effort`;
}

export function sanitizeStatus(text: string): string {
  // strip ANSI + control chars — extracted from utils.ts for single ownership
  const stripAnsi = (s: string) =>
    s
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b_[^\x07]*\x07/g, "");
  return stripAnsi(text)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b_[^\x07]*\x07/g, "");
}
