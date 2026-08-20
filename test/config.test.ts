import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("config", () => {
  test("DEFAULT_CONFIG has expected defaults", () => {
    assert.equal(DEFAULT_CONFIG.enabled, true);
    assert.equal(DEFAULT_CONFIG.workspaceDisplay, "path");
    assert.equal(DEFAULT_CONFIG.cursorStyle, "block");
    assert.equal(DEFAULT_CONFIG.icons.mode, "auto");
    assert.equal(DEFAULT_CONFIG.footerSegments.cwd, true);
    assert.equal(DEFAULT_CONFIG.telemetry.enabled, true);
  });

  test("workspaceDisplay toggles path vs name", () => {
    const pathConfig = { ...DEFAULT_CONFIG, workspaceDisplay: "path" as const };
    const nameConfig = { ...DEFAULT_CONFIG, workspaceDisplay: "name" as const };
    assert.equal(pathConfig.workspaceDisplay, "path");
    assert.equal(nameConfig.workspaceDisplay, "name");
  });
});
