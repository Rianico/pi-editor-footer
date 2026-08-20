import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearRuntimeCache, readRuntimeInfo } from "../src/runtime.js";

describe("runtime", () => {
  test("detects nodejs via package.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-node-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      clearRuntimeCache();
      const info = await readRuntimeInfo(dir);
      assert.ok(info);
      assert.equal(info!.name, "nodejs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects python via pyproject.toml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-py-"));
    try {
      writeFileSync(join(dir, "pyproject.toml"), "[tool.poetry]");
      clearRuntimeCache();
      const info = await readRuntimeInfo(dir);
      assert.ok(info);
      assert.equal(info!.name, "python");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects rust via Cargo.toml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-rust-"));
    try {
      writeFileSync(join(dir, "Cargo.toml"), "[package]");
      clearRuntimeCache();
      const info = await readRuntimeInfo(dir);
      assert.ok(info);
      assert.equal(info!.name, "rust");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null for empty dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-empty-"));
    try {
      clearRuntimeCache();
      const info = await readRuntimeInfo(dir);
      assert.equal(info, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cache returns same on repeat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-cache-"));
    try {
      writeFileSync(join(dir, "go.mod"), "module example");
      clearRuntimeCache();
      const a = await readRuntimeInfo(dir);
      const b = await readRuntimeInfo(dir);
      assert.ok(a && b && a.name === b.name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
