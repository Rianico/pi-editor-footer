/**
 * Internals-doc drift guard.
 *
 * `docs/reference/pi-tui-internals.md` is the sync contract for the editor
 * replacement (ADR-0001/ADR-0002): it names the pi version we verify against
 * and the private internals we read. An out-of-date doc is worse than no doc,
 * so it is pinned here:
 *
 *  - the doc must name the installed (pinned) `@earendil-works/pi-tui` version;
 *  - the two load-bearing private internals must still exist in the installed
 *    pi-tui `Editor`, and the doc must still name them (and the public border
 *    hooks a maintainer should port into first).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { Editor } from "@earendil-works/pi-tui";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_PATH = join(ROOT, "docs", "reference", "pi-tui-internals.md");

function doc(): string {
  return readFileSync(DOC_PATH, "utf8");
}

function pinnedPiTuiVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  const version = pkg.devDependencies?.["@earendil-works/pi-tui"];
  assert.ok(version, "package.json must pin a @earendil-works/pi-tui devDependency");
  return version;
}

function installedEditorSource(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@earendil-works/pi-tui");
  return readFileSync(join(dirname(entry), "components", "editor.js"), "utf8");
}

describe("pi-tui internals doc ↔ installed package", () => {
  test("doc names the pinned pi-tui version", () => {
    const version = pinnedPiTuiVersion();
    assert.ok(
      doc().includes(version),
      `docs/reference/pi-tui-internals.md must name the pinned pi-tui ${version}`,
    );
  });

  test("private field autocompleteList still exists and is named by the doc", () => {
    assert.match(
      installedEditorSource(),
      /this\.autocompleteList/,
      "pi-tui Editor must still own autocompleteList",
    );
    assert.match(doc(), /autocompleteList/);
  });

  test("private method applyAutocompleteSuggestions still exists and is named by the doc", () => {
    assert.equal(
      typeof (Editor.prototype as unknown as Record<string, unknown>)[
        "applyAutocompleteSuggestions"
      ],
      "function",
      "pi-tui Editor.prototype.applyAutocompleteSuggestions must remain a method",
    );
    assert.match(doc(), /applyAutocompleteSuggestions/);
  });

  test("public border hooks exist and are named by the doc", () => {
    for (const hook of ["renderTopBorder", "renderBottomBorder"]) {
      assert.equal(
        typeof (Editor.prototype as unknown as Record<string, unknown>)[hook],
        "function",
      );
      assert.ok(doc().includes(hook), `doc must name the public subclass seam ${hook}`);
    }
  });
});
