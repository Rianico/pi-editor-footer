/**
 * Characterization (golden) tests for the settings UI's pure functions.
 *
 * Expected values were captured from the pre-refactor implementation
 * (tmp/c2-capture.ts → tmp/c2-golden.json at the commit before the descriptor
 * refactor): row ids/labels/currentValue for every tab on DEFAULT_CONFIG, and
 * the result of one and two changes for every (tab, id). Item ids and label
 * bytes are a hard contract — SelectList behavior and screen output depend on
 * them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONFIG_SCHEMA,
  DEFAULT_CONFIG,
  descriptorRowId,
  getByPath,
  setByPath,
  type ConfigTab,
  type ThemeConfig,
} from "../src/config.js";
import { applySettingChange, settingRowsFor } from "../src/theme-settings.js";

const TABS: readonly ConfigTab[] = ["general", "appearance", "footer", "telemetry", "timeline"];

interface SettingRow {
  id: string;
  label: string;
  currentValue: string;
}

// —————————————————————————————— golden rows ——————————————————————————————

const GOLDEN_ROWS: Record<(typeof TABS)[number], SettingRow[]> = {
  general: [
    { id: "enabled", label: "Enabled", currentValue: "On" },
    { id: "workspaceDisplay", label: "Workspace display", currentValue: "Full path" },
    { id: "cursorStyle", label: "Cursor style", currentValue: "Block" },
  ],
  appearance: [{ id: "iconMode", label: "Icon mode", currentValue: "Auto" }],
  footer: [
    { id: "cwd", label: "CWD", currentValue: "On" },
    { id: "sessionName", label: "Session name", currentValue: "Off" },
    { id: "gitBranch", label: "Git branch", currentValue: "On" },
    { id: "gitStatus", label: "Git status", currentValue: "On" },
    { id: "gitCommit", label: "Git commit (detached)", currentValue: "Off" },
    { id: "runtime", label: "Runtime", currentValue: "On" },
    { id: "context", label: "Context bar", currentValue: "On" },
    { id: "contextIconBar", label: "Context icon bar", currentValue: "Off" },
    { id: "tokens", label: "Tokens", currentValue: "On" },
    { id: "cost", label: "Cost", currentValue: "On" },
    { id: "extensionStatuses", label: "Extension status line", currentValue: "On" },
  ],
  telemetry: [
    { id: "enabled", label: "Enabled", currentValue: "On" },
    { id: "tps", label: "TPS", currentValue: "On" },
    { id: "ttft", label: "TTFT", currentValue: "On" },
    { id: "duration", label: "Total duration", currentValue: "On" },
    { id: "tokens", label: "Tokens", currentValue: "On" },
    { id: "stalls", label: "Stall details", currentValue: "On" },
    { id: "cost", label: "Cost rate", currentValue: "On" },
  ],
  timeline: [
    { id: "enabled", label: "Timeline enabled", currentValue: "On" },
    { id: "wallTime", label: "Wall time", currentValue: "On" },
    { id: "tokens", label: "Tokens", currentValue: "On" },
    { id: "cost", label: "Cost", currentValue: "On" },
  ],
};

// ———————————————— golden one-change results (exactly one leaf differs) ————————————————

const GOLDEN_ONCE: Record<string, [path: string, value: string | boolean]> = {
  "general:enabled": ["enabled", false],
  "general:workspaceDisplay": ["workspaceDisplay", "name"],
  "general:cursorStyle": ["cursorStyle", "bar"],
  "appearance:iconMode": ["icons.mode", "nerd"],
  "footer:cwd": ["footerSegments.cwd", false],
  "footer:sessionName": ["footerSegments.sessionName", true],
  "footer:gitBranch": ["footerSegments.gitBranch", false],
  "footer:gitStatus": ["footerSegments.gitStatus", false],
  "footer:gitCommit": ["footerSegments.gitCommit", true],
  "footer:runtime": ["footerSegments.runtime", false],
  "footer:context": ["footerSegments.context", false],
  "footer:contextIconBar": ["contextIconBar", true],
  "footer:tokens": ["footerSegments.tokens", false],
  "footer:cost": ["footerSegments.cost", false],
  "footer:extensionStatuses": ["footerSegments.extensionStatuses", false],
  "telemetry:enabled": ["telemetry.enabled", false],
  "telemetry:tps": ["telemetry.tps", false],
  "telemetry:ttft": ["telemetry.ttft", false],
  "telemetry:duration": ["telemetry.duration", false],
  "telemetry:tokens": ["telemetry.tokens", false],
  "telemetry:stalls": ["telemetry.stalls", false],
  "telemetry:cost": ["telemetry.cost", false],
  "timeline:enabled": ["timeline.enabled", false],
  "timeline:wallTime": ["timeline.wallTime", false],
  "timeline:tokens": ["timeline.tokens", false],
  "timeline:cost": ["timeline.cost", false],
};

// Golden two-change results: every boolean and the 2-value workspaceDisplay
// cycle returns to defaults; the 3-value enums land one step further.
const GOLDEN_TWICE_EXTRA: Record<string, [path: string, value: string]> = {
  "general:cursorStyle": ["cursorStyle", "underline"],
  "appearance:iconMode": ["icons.mode", "ascii"],
};

function setLeaf(config: ThemeConfig, path: string, value: string | boolean): ThemeConfig {
  const clone = structuredClone(config) as unknown as Record<string, unknown>;
  const parts = path.split(".");
  let cur = clone;
  for (const p of parts.slice(0, -1)) {
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
  return clone as unknown as ThemeConfig;
}

function leafDiffPaths(a: ThemeConfig, b: ThemeConfig): string[] {
  const flat = (o: unknown, pre = ""): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v !== null && typeof v === "object") Object.assign(out, flat(v, `${pre}${k}.`));
      else out[`${pre}${k}`] = v;
    }
    return out;
  };
  const fa = flat(a);
  const fb = flat(b);
  assert.deepEqual(Object.keys(fb).sort(), Object.keys(fa).sort());
  return Object.keys(fa).filter((p) => fa[p] !== fb[p]);
}

describe("settings rows (characterization)", () => {
  for (const tab of TABS) {
    test(`${tab}: rows match golden ids/labels/currentValue`, () => {
      assert.deepEqual(settingRowsFor(tab, structuredClone(DEFAULT_CONFIG)), GOLDEN_ROWS[tab]);
    });
  }
});

describe("settings change (characterization)", () => {
  for (const tab of TABS) {
    for (const row of GOLDEN_ROWS[tab]) {
      const key = `${tab}:${row.id}`;
      test(`${key}: one change matches golden result`, () => {
        const [path, value] = GOLDEN_ONCE[key]!;
        const expected = setLeaf(DEFAULT_CONFIG, path, value);
        const once = applySettingChange(tab, row.id, structuredClone(DEFAULT_CONFIG));
        assert.deepEqual(once, expected);
        assert.deepEqual(leafDiffPaths(DEFAULT_CONFIG, once), [path]);
      });
      test(`${key}: two changes match golden result (toggle/cycle identity)`, () => {
        const once = applySettingChange(tab, row.id, structuredClone(DEFAULT_CONFIG));
        const twice = applySettingChange(tab, row.id, once);
        const extra = GOLDEN_TWICE_EXTRA[key];
        const expected = extra ? setLeaf(DEFAULT_CONFIG, extra[0], extra[1]) : DEFAULT_CONFIG;
        assert.deepEqual(twice, expected);
      });
    }
  }
});

// —————————————————————————————— completeness guards ——————————————————————————————

describe("descriptor table completeness", () => {
  test("every DEFAULT_CONFIG leaf path has exactly one schema row (no orphan leaf)", () => {
    const leaves = (o: unknown, pre = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        v !== null && typeof v === "object" ? leaves(v, `${pre}${k}.`) : [`${pre}${k}`],
      );
    const leafPaths = leaves(structuredClone(DEFAULT_CONFIG)).sort();
    const rowPaths = CONFIG_SCHEMA.map((r) => r.path).sort();
    assert.deepEqual(rowPaths, leafPaths);
    assert.equal(new Set(rowPaths).size, rowPaths.length, "no duplicate row paths");
  });

  test("every schema row has a non-empty label and a tab (row must render)", () => {
    for (const row of CONFIG_SCHEMA) {
      assert.ok(row.label.length > 0, `row ${row.path} has empty label`);
      assert.ok(TABS.includes(row.tab), `row ${row.path} has unknown tab ${row.tab}`);
    }
  });

  test("every schema row default equals the DEFAULT_CONFIG leaf (single source)", () => {
    for (const row of CONFIG_SCHEMA) {
      assert.equal(
        getByPath(DEFAULT_CONFIG, row.path),
        row.default,
        `default drift at ${row.path}`,
      );
    }
  });

  test("row ids are unique within each tab (SelectList contract)", () => {
    for (const tab of TABS) {
      const ids = CONFIG_SCHEMA.filter((r) => r.tab === tab).map(descriptorRowId);
      assert.equal(new Set(ids).size, ids.length, `duplicate ids in tab ${tab}`);
    }
  });
});

describe("enum cycle order (descriptor-driven)", () => {
  for (const row of CONFIG_SCHEMA.filter((r) => r.kind === "enum")) {
    test(`${row.path}: change advances through values in table order and wraps`, () => {
      assert.ok(row.values.length > 0);
      for (let i = 0; i < row.values.length; i++) {
        const cfg = structuredClone(DEFAULT_CONFIG);
        setByPath(cfg, row.path, row.values[i]);
        const next = applySettingChange(row.tab, descriptorRowId(row), cfg);
        assert.equal(
          getByPath(next, row.path),
          row.values[(i + 1) % row.values.length],
          `from ${row.values[i]}`,
        );
      }
      // unknown current value restarts at values[0] (parity with old cycle*)
      const cfg = structuredClone(DEFAULT_CONFIG);
      setByPath(cfg, row.path, "not-a-value");
      assert.equal(
        getByPath(applySettingChange(row.tab, descriptorRowId(row), cfg), row.path),
        row.values[0],
      );
    });
  }
});
