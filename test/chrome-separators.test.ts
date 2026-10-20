/**
 * One separator rule (ADR-0004): `|` separates fields, `·` separates sections
 * inside a field. `•` is retired from the chrome.
 *
 * Field = an answer to a different question (`where am I` vs `what runtime`),
 * section = another slice of the same answer (cache / usage / window are all
 * the context field). The rule is asserted at the two seams that render it —
 * the footer line and the top rule — plus a source sweep so a stray `•` cannot
 * creep back into a chrome helper.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { BorderRenderer } from "../src/border-renderer.js";
import { formatTotalsLine } from "../src/cache-format.js";
import type { CacheUsageTotals } from "../src/cache-types.js";
import { formatContextBar } from "../src/chrome-state.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { renderFooter } from "../src/footer.js";
import { emptyGitStatus } from "../src/git.js";
import { resolveGlyphs } from "../src/icons.js";
import type { ThemeLike } from "../src/model-info.js";
import { createInitialState } from "../src/state.js";
import { formatTelemetryTokens } from "../src/telemetry.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Identity theme: separators are asserted as characters, styling as structure. */
const theme: ThemeLike = {
  getFgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (s: string) => s,
  fg: (_style: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  muted: (text: string) => text,
};

const ASCII_CONFIG = {
  ...DEFAULT_CONFIG,
  icons: { ...DEFAULT_CONFIG.icons, mode: "ascii" as const },
};

const TOTALS = {
  input: 14_000_000,
  output: 89_000,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0.15,
} as never;

function footerState(withRuntime = true) {
  const base = createInitialState();
  return {
    ...base,
    git: { ...emptyGitStatus(), branch: "main", untracked: 1 },
    ...(withRuntime ? { runtime: { name: "node", version: "26.8.1" } } : {}),
  } as never;
}

function footerLine(withRuntime = true): string {
  const lines = renderFooter(120, footerState(withRuntime), ASCII_CONFIG as never, theme as never, {
    cwd: "/Users/test/repo",
    totals: TOTALS,
  });
  return lines[0] ?? "";
}

function topRule(contextText: string): string {
  const renderer = new BorderRenderer(
    () => theme,
    () => ({
      provider: "opencode-go",
      modelId: "deepseek-v4.1-flash",
      level: "high",
      contextWindow: 1_000_000,
    }),
  );
  return (
    renderer.renderWithBorders(["hello"], 100, {
      glowEnabled: true,
      topContextText: contextText,
    })[0] ?? ""
  );
}

const CONTEXT_USAGE = { tokens: 146_000, percent: 14.6, contextWindow: 1_000_000 };

describe("separator rule: `|` between fields, `·` within a field", () => {
  test("footer left: `cwd · git` is one field, the runtime is another", () => {
    const line = footerLine();
    assert.ok(
      line.includes("main ?  | node 26.8.1"),
      `runtime must sit behind a field boundary, got: ${line}`,
    );
    assert.ok(!line.includes("main ?  •"), "the bullet separator is retired");
  });

  test("footer left: no runtime, no field boundary", () => {
    const line = footerLine(false);
    assert.ok(line.includes("/Users/test/repo  · main ?"), line);
    assert.ok(!line.includes("|"), "one field only — nothing to separate");
  });

  test("footer stats stay one field: `↑ · ↓ · $`", () => {
    const line = footerLine();
    assert.ok(line.includes("↑ 14M · ↓ 89k · $0.15"), line);
    assert.ok(!line.includes("↑ 14M |"), "tokens are sections of the usage field");
  });

  test("context bar: cache is a section of the context field, not a field", () => {
    const bar = formatContextBar(
      CONTEXT_USAGE,
      theme as never,
      resolveGlyphs("ascii"),
      true,
      10,
      98.1,
    );
    assert.equal(bar, "c 98.1% · 14.6% · 146k/1.0M");
    assert.ok(!bar.includes("|"), "no field boundary inside the context bar");
  });

  test("top rule: the `|` before the context field survives", () => {
    const bar = formatContextBar(
      CONTEXT_USAGE,
      theme as never,
      resolveGlyphs("ascii"),
      true,
      10,
      98.1,
    );
    const top = topRule(bar);
    assert.ok(
      top.includes("opencode-go/deepseek-v4.1-flash · high | c 98.1% · 14.6% · 146k/1.0M"),
      top,
    );
  });

  test("tokens-above line joins input and output with `·`", () => {
    const text = formatTelemetryTokens(
      { inputTokens: 14_000_000, outputTokens: 89_000 } as never,
      theme as never,
      { ...DEFAULT_CONFIG.telemetry, tokens: true },
      { input: "↑", output: "↓" },
    );
    assert.equal(text, "↑ 14M · ↓ 89k");
  });

  test("cache totals line uses `·`, not the retired bullet", () => {
    const totals: CacheUsageTotals = {
      input: 1_000,
      output: 2_000,
      cacheRead: 500,
      cacheWrite: 250,
      totalTokens: 3_750,
      assistantMessages: 3,
    };
    const line = formatTotalsLine("session", totals);
    assert.ok(!line.includes("•"), line);
    assert.ok(line.includes("session: 3 turns · prompt 1,750 · received 2,000"), line);
  });

  test("no `•` separator survives in a chrome-rendering source file", () => {
    const chromeSources = [
      "footer.ts",
      "chrome-state.ts",
      "border-renderer.ts",
      "cache-format.ts",
      "cache-stats-view.ts",
      "cache-graph-view.ts",
      "cache-command.ts",
      "cache-scroll-dialog.ts",
      "telemetry.ts",
    ];
    const offenders = chromeSources.filter((file) =>
      readFileSync(join(SRC, file), "utf8").includes("•"),
    );
    assert.deepEqual(offenders, [], `retired bullet still rendered by: ${offenders.join(", ")}`);
  });
});
