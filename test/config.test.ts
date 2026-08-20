import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG, getConfigPath, loadConfig, saveConfig } from "../src/config.js";
import { formatCwd, basenamePath, truncatePath, displayCwd } from "../src/utils-workspace.js";

describe("DEFAULT_CONFIG", () => {
  test("has expected defaults", () => {
    assert.equal(DEFAULT_CONFIG.enabled, true);
    assert.equal(DEFAULT_CONFIG.workspaceDisplay, "path");
    assert.equal(DEFAULT_CONFIG.cursorStyle, "block");
    assert.equal(DEFAULT_CONFIG.icons.mode, "auto");
    assert.equal(DEFAULT_CONFIG.telemetry.enabled, true);
    assert.equal(DEFAULT_CONFIG.footerSegments.cwd, true);
  });
});

describe("getConfigPath", () => {
  test("returns homedir based path", () => {
    const p = getConfigPath();
    assert.ok(p.endsWith(".pi/agent/pi-skill-desc.json"), p);
  });
});

describe("loadConfig / saveConfig with temp HOME", () => {
  let origHome: string | undefined;
  let origUserProfile: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    tmpHome = mkdtempSync(join(tmpdir(), "pi-skill-desc-test-"));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  });

  test("loadConfig returns defaults when no file exists", () => {
    const cfg = loadConfig();
    assert.deepEqual(cfg, DEFAULT_CONFIG);
  });

  test("saveConfig merges and persists", () => {
    const saved = saveConfig({ workspaceDisplay: "name" } as any);
    assert.equal(saved.workspaceDisplay, "name");
    // reload should persist
    const reloaded = loadConfig();
    assert.equal(reloaded.workspaceDisplay, "name");
    assert.equal(reloaded.cursorStyle, DEFAULT_CONFIG.cursorStyle);
  });

  test("malformed JSON falls back to defaults with warning", () => {
    const cfgPath = getConfigPath();
    mkdirSync(join(cfgPath, ".."), { recursive: true });
    writeFileSync(cfgPath, "{ not valid json", "utf8");
    const cfg = loadConfig();
    assert.deepEqual(cfg, DEFAULT_CONFIG);
  });

  test("invalid enum values fallback to defaults", () => {
    const cfgPath = getConfigPath();
    mkdirSync(join(cfgPath, ".."), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ workspaceDisplay: "invalid", cursorStyle: "bad", icons: { mode: "nope" } }), "utf8");
    const cfg = loadConfig();
    assert.equal(cfg.workspaceDisplay, DEFAULT_CONFIG.workspaceDisplay);
    assert.equal(cfg.cursorStyle, DEFAULT_CONFIG.cursorStyle);
    assert.equal(cfg.icons.mode, DEFAULT_CONFIG.icons.mode);
  });

  test("saveConfig validates enums", () => {
    const saved = saveConfig({ workspaceDisplay: "invalid" as any, cursorStyle: "bar" });
    assert.equal(saved.workspaceDisplay, DEFAULT_CONFIG.workspaceDisplay);
    assert.equal(saved.cursorStyle, "bar");
  });

  test("deep merge preserves nested defaults", () => {
    const cfgPath = getConfigPath();
    mkdirSync(join(cfgPath, ".."), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ telemetry: { tps: false } }), "utf8");
    const cfg = loadConfig();
    assert.equal(cfg.telemetry.tps, false);
    assert.equal(cfg.telemetry.ttft, true); // preserved
    assert.equal(cfg.telemetry.duration, true);
  });
});

describe("utils-workspace helpers", () => {
  const origHome = process.env.HOME;
  beforeEach(() => {
    // Use a stable HOME for these tests
    process.env.HOME = "/home/testuser";
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  test("formatCwd: inside HOME becomes ~", () => {
    // HOME is /home/testuser, cwd is /home/testuser/projects/foo
    const formatted = formatCwd("/home/testuser/projects/foo");
    assert.ok(formatted.startsWith("~"), formatted);
  });

  test("formatCwd: outside HOME stays absolute", () => {
    const formatted = formatCwd("/tmp/other");
    assert.equal(formatted, "/tmp/other");
  });

  test("basenamePath", () => {
    assert.equal(basenamePath("/foo/bar/baz"), "baz");
    assert.equal(basenamePath("~/projects/my-workspace"), "my-workspace");
    assert.equal(basenamePath("single"), "single");
  });

  test("truncatePath: short path unchanged", () => {
    assert.equal(truncatePath("~/a/b", 20), "~/a/b");
  });

  test("truncatePath: long path truncated with ...", () => {
    const long = "~/a/b/c/d/e/f/g/h";
    const truncated = truncatePath(long, 8);
    assert.ok(truncated.includes("..."), truncated);
    assert.ok(truncated.length <= 8, `len ${truncated.length} <= 8`);
  });

  test("displayCwd: path vs name mode", () => {
    const cwd = "/home/testuser/projects/my-workspace";
    const asPath = displayCwd(cwd, "path");
    const asName = displayCwd(cwd, "name");
    assert.ok(asPath.includes("my-workspace"), asPath);
    assert.equal(asName, "my-workspace");
    // name mode should be basename of formatted path
    assert.equal(asName, basenamePath(formatCwd(cwd)));
  });
});
