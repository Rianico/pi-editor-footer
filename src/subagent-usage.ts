/**
 * Subagent usage — delegated-child accounting that pi never puts on a parent entry.
 *
 * A delegated child runs in its own session (a separate file), so its tokens and cost
 * exist only in the subagent extension's payloads. This module is the single home for
 * reading those payloads and for the record set the footer/timeline totals fold in.
 *
 * Three shapes are read, all version-sensitive to the INSTALLED pi-subagents
 * (see docs/reference/pi-subagents-events.md):
 *   - foreground tool result details — `details.results[].usage` per child;
 *   - `subagent:async-complete` on pi's event bus — `results[].usage`, `totalCost` fallback;
 *   - this extension's own `subagent-usage` custom session entry — the persisted record set.
 *
 * Dedupe has two levels and both are load-bearing:
 *   - `key` — one child, one record. Every channel that re-delivers the same child
 *     (event replay, a second launch report) upserts the same key instead of adding.
 *   - `toolCallId` — pi core copies a tool result's aggregate `usage` onto its
 *     `toolResult` session entry, which `getUsageTotals` already counts. A record whose
 *     parent call is already in the entries is dropped there, so the same child is never
 *     counted twice across channels.
 */

/** Custom-entry type this module persists under — one entry per update, cumulative records. */
export const SUBAGENT_USAGE_ENTRY_TYPE = "subagent-usage";

/** `details.mode` values pi-subagents uses for a delegated run (never "management"). */
const SUBAGENT_MODES: ReadonlySet<string> = new Set(["single", "parallel", "chain", "workflow"]);

/** One delegated child's billed usage. Numbers are already normalized (missing → 0). */
export interface SubagentUsageRecord {
  /** Dedupe identity of the child: `<runId or toolCallId>#<index>`, or the sole run id. */
  key: string;
  /** Parent tool call that delivered the record, when one did — the cross-channel dedupe key. */
  toolCallId?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/** Payload of a `subagent-usage` custom entry: CUMULATIVE records, not a delta. */
export interface SubagentUsageEntryData {
  records: SubagentUsageRecord[];
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `usage.cost` is a number in pi-subagents payloads and `{ total }` on pi tool usage. */
function costOf(usage: Record<string, unknown>): number {
  const cost = usage.cost;
  if (typeof cost === "number") return finiteNumber(cost);
  const nested = asRecord(cost);
  return nested ? finiteNumber(nested.total) : 0;
}

/** Build a record from one usage block; an all-zero block is not worth a record. */
function recordFromUsage(
  usage: unknown,
  key: string,
  toolCallId?: string,
): SubagentUsageRecord | undefined {
  const block = asRecord(usage);
  if (!block) return undefined;
  const record: SubagentUsageRecord = {
    key,
    ...(toolCallId ? { toolCallId } : {}),
    input: finiteNumber(block.input),
    output: finiteNumber(block.output),
    cacheRead: finiteNumber(block.cacheRead),
    cacheWrite: finiteNumber(block.cacheWrite),
    cost: costOf(block),
  };
  const spent =
    record.input !== 0 ||
    record.output !== 0 ||
    record.cacheRead !== 0 ||
    record.cacheWrite !== 0 ||
    record.cost !== 0;
  return spent ? record : undefined;
}

/**
 * Records a foreground `subagent` tool result carries. Shape-detected (not tool-name
 * detected) so a renamed tool still works, and guarded so any other tool result —
 * including a management action with no children — yields nothing.
 */
export function subagentUsageFromToolResult(input: {
  toolCallId?: string;
  toolName?: string;
  result?: unknown;
}): SubagentUsageRecord[] {
  const details = asRecord(asRecord(input.result)?.details);
  if (!details) return [];
  const mode = details.mode;
  const results = Array.isArray(details.results) ? details.results : undefined;
  const isSubagentRun =
    (typeof mode === "string" && SUBAGENT_MODES.has(mode)) ||
    (input.toolName === "subagent" && results !== undefined);
  if (!isSubagentRun || results === undefined) return [];

  const toolCallId = input.toolCallId;
  const anchor = nonEmptyString(details.runId) ?? toolCallId ?? SUBAGENT_USAGE_ENTRY_TYPE;
  const records: SubagentUsageRecord[] = [];
  for (const [index, child] of results.entries()) {
    const record = recordFromUsage(asRecord(child)?.usage, `${anchor}#${index}`, toolCallId);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Records a `subagent:async-complete` payload carries. The completion reports one
 * usage block per child result; older payloads carry only the aggregate `totalCost`,
 * which has an input/output/cost triple but no cache split.
 */
export function subagentUsageFromAsyncComplete(payload: unknown): SubagentUsageRecord[] {
  const event = asRecord(payload);
  if (!event) return [];
  const anchor = nonEmptyString(event.runId) ?? nonEmptyString(event.id);
  if (!anchor) return [];

  const results = Array.isArray(event.results) ? event.results : [];
  const records: SubagentUsageRecord[] = [];
  for (const [index, child] of results.entries()) {
    const record = recordFromUsage(asRecord(child)?.usage, `${anchor}#${index}`);
    if (record) records.push(record);
  }
  if (records.length > 0) return records;

  const total = asRecord(event.totalCost);
  if (!total) return [];
  const aggregate: SubagentUsageRecord = {
    key: anchor,
    input: finiteNumber(total.inputTokens),
    output: finiteNumber(total.outputTokens),
    cacheRead: 0,
    cacheWrite: 0,
    cost: finiteNumber(total.costUsd),
  };
  const spent = aggregate.input !== 0 || aggregate.output !== 0 || aggregate.cost !== 0;
  return spent ? [aggregate] : [];
}

/** One sanitized record, or undefined for a malformed payload (never throws on junk). */
function sanitizeRecord(value: unknown): SubagentUsageRecord | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const key = nonEmptyString(raw.key);
  if (!key) return undefined;
  const toolCallId = nonEmptyString(raw.toolCallId);
  return {
    key,
    ...(toolCallId ? { toolCallId } : {}),
    input: finiteNumber(raw.input),
    output: finiteNumber(raw.output),
    cacheRead: finiteNumber(raw.cacheRead),
    cacheWrite: finiteNumber(raw.cacheWrite),
    cost: finiteNumber(raw.cost),
  };
}

/**
 * Restore the record set from session history: the LAST USABLE `subagent-usage` entry
 * wins (each stores the cumulative list, same rule as `session-run-time`), and a
 * malformed payload is skipped so a corrupt tail cannot erase a valid set behind it.
 * A history without the entry (fresh session, or the toggle never on) restores nothing.
 */
export function restoreSubagentUsageRecords(
  entries: readonly unknown[] | undefined,
): SubagentUsageRecord[] {
  if (!entries) return [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = asRecord(entries[i]);
    if (entry?.type !== "custom" || entry.customType !== SUBAGENT_USAGE_ENTRY_TYPE) continue;
    const raw = asRecord(entry.data)?.records;
    // A truncated or foreign-schema payload is skipped, not read as "no children": the
    // valid cumulative entry behind it would otherwise be erased (#66 rework 1, R3).
    if (!Array.isArray(raw)) continue;
    const records: SubagentUsageRecord[] = [];
    for (const candidate of raw) {
      const record = sanitizeRecord(candidate);
      if (record) records.push(record);
    }
    // A NON-empty array with nothing usable is a corrupt tail too (e.g. `[{input: 999}]`
    // without a key) — keep scanning. An empty array is a real empty set: the writer only
    // stores a non-empty list, so `[]` means "restored empty", not "truncated".
    if (raw.length > 0 && records.length === 0) continue;
    return records;
  }
  return [];
}

/** The record set the LAST `subagent-usage` entry carries — what the totals fold in. */
export function lastSubagentUsageRecords(
  entries: readonly unknown[] | undefined,
): SubagentUsageRecord[] {
  return restoreSubagentUsageRecords(entries);
}

function sameRecord(a: SubagentUsageRecord, b: SubagentUsageRecord): boolean {
  return (
    a.toolCallId === b.toolCallId &&
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.cost === b.cost
  );
}

/**
 * The in-memory record set. Keys make every channel idempotent: a re-delivered child
 * replaces its own record, so a foreground call that arrives through two channels
 * still counts once.
 */
export class SubagentUsageLedger {
  private byKey = new Map<string, SubagentUsageRecord>();

  /** Seed from session history — replaces any prior state (this IS the session_start reset). */
  restoreFromEntries(entries: readonly unknown[] | undefined): void {
    this.byKey = new Map(
      restoreSubagentUsageRecords(entries).map((record) => [record.key, record]),
    );
  }

  /** Upsert records by key. Returns true when the set actually changed (a repaint is owed). */
  record(records: readonly SubagentUsageRecord[]): boolean {
    let changed = false;
    for (const record of records) {
      const previous = this.byKey.get(record.key);
      if (!previous || !sameRecord(previous, record)) changed = true;
      this.byKey.set(record.key, record);
    }
    return changed;
  }

  /** Cumulative records, in insertion order — what a persistence entry stores. */
  records(): SubagentUsageRecord[] {
    return [...this.byKey.values()];
  }

  size(): number {
    return this.byKey.size;
  }

  clear(): void {
    this.byKey.clear();
  }
}
