import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { adaptTheme } from "../src/chrome-theme.js";
import { resolveThinkingGlow } from "../src/model-info.js";

const fakeTheme = {
  fg: (style: string, s: string) => `[${style}]${s}[/]`,
  getThinkingBorderColor: (level: string) => (s: string) => `<${level}>${s}`,
} as unknown as { fg: (s: string, t: string) => string };

describe("chrome-theme", () => {
  test("adaptTheme delegates to fg when present", () => {
    const t = adaptTheme(fakeTheme);
    assert.equal(t.fg("dim", "hello"), "[dim]hello[/]");
  });

  test("adaptTheme identity when fg missing", () => {
    const t = adaptTheme({});
    assert.equal(t.fg("dim", "hello"), "hello");
  });

  test("adaptTheme identity when fg not function", () => {
    const t = adaptTheme({ fg: "not-a-function" } as unknown as never);
    assert.equal(t.fg("dim", "hello"), "hello");
  });
});

describe("resolveThinkingGlow (single glow home, ADR-0002)", () => {
  test("returns glow when theme has getThinkingBorderColor", () => {
    const g = resolveThinkingGlow(fakeTheme);
    assert.ok(typeof g === "function");
    assert.equal(g!("low", "x"), "<low>x");
  });

  test("returns undefined when theme lacks the extension", () => {
    const g = resolveThinkingGlow({ fg: () => "" } as unknown as never);
    assert.equal(g, undefined);
  });

  test("throwing glow degrades to identity for that string", () => {
    const bad = {
      getThinkingBorderColor: () => () => {
        throw new Error("boom");
      },
    } as unknown as never;
    const g = resolveThinkingGlow(bad);
    assert.ok(typeof g === "function");
    assert.equal(g!("low", "x"), "x");
  });
});
