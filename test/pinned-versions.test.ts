import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  check,
  diffVersions,
  FIX_COMMAND,
  formatMismatch,
  formatReport,
  isExact,
  lockVersions,
  resolvePins,
  stripRange,
  WATCHED_PACKAGES,
} from "../scripts/check-pinned-versions.js";
import type { ManifestLike, Pin } from "../scripts/check-pinned-versions.js";

const TUI = "@earendil-works/pi-tui";
const AGENT = "@earendil-works/pi-coding-agent";

/** Shape of the real pnpm-lock.yaml snapshot keys. */
const LOCK = `
snapshots:

  '@earendil-works/pi-coding-agent@1.3.0':
    resolution: {integrity: sha512-aaa}

  '@earendil-works/pi-tui@1.3.0':
    resolution: {integrity: sha512-bbb}
`;

describe("pinned versions — specs", () => {
  test("range prefixes are stripped", () => {
    assert.equal(stripRange("1.3.0"), "1.3.0");
    assert.equal(stripRange("^1.3.0"), "1.3.0");
    assert.equal(stripRange("~1.3.0"), "1.3.0");
    assert.equal(stripRange("=1.3.0"), "1.3.0");
  });

  test("only an exact semver is a pin", () => {
    assert.equal(isExact("1.3.0"), true);
    assert.equal(isExact("1.3.0-beta.1"), true);
    assert.equal(isExact("*"), false);
    assert.equal(isExact("latest"), false);
    assert.equal(isExact(">=1.0.0"), false);
  });
});

describe("pinned versions — lockfile", () => {
  test("finds the resolved version for a package", () => {
    assert.deepEqual(lockVersions(LOCK, TUI), ["1.3.0"]);
    assert.deepEqual(lockVersions(LOCK, AGENT), ["1.3.0"]);
  });

  test("a package absent from the lockfile yields nothing", () => {
    assert.deepEqual(lockVersions(LOCK, "@earendil-works/pi-mcp"), []);
  });

  test("two resolutions are both reported, so the caller can refuse to guess", () => {
    const dual = `${LOCK}\n  '@earendil-works/pi-tui@0.84.2':\n    resolution: {integrity: sha512-ccc}\n`;
    assert.deepEqual(lockVersions(dual, TUI).sort(), ["0.84.2", "1.3.0"]);
  });
});

describe("pinned versions — resolving the pin", () => {
  const manifest: ManifestLike = {
    devDependencies: { [TUI]: "1.3.0" },
    // pi-coding-agent is a `*` peer, so package.json cannot pin it
    peerDependencies: { [AGENT]: "*" },
  };

  test("an exact devDependency is the pin, sourced from package.json", () => {
    const pins = resolvePins(manifest, LOCK);
    assert.deepEqual(
      pins.find((p) => p.name === TUI),
      {
        name: TUI,
        pinned: "1.3.0",
        source: "package.json",
      },
    );
  });

  test("a `*` peer falls back to the single lockfile resolution", () => {
    const pins = resolvePins(manifest, LOCK);
    assert.deepEqual(
      pins.find((p) => p.name === AGENT),
      {
        name: AGENT,
        pinned: "1.3.0",
        source: "pnpm-lock.yaml",
      },
    );
  });

  test("an ambiguous lockfile resolution refuses to produce a pin", () => {
    const dual = `${LOCK}\n  '@earendil-works/pi-tui@0.84.2':\n    resolution: {integrity: sha512-ccc}\n`;
    const pins = resolvePins({ peerDependencies: { [TUI]: "*" } }, dual);
    assert.equal(
      pins.some((pin) => pin.name === TUI),
      false,
      "guessing between two versions would hide the drift",
    );
    assert.ok(
      pins.some((pin) => pin.name === AGENT),
      "the other package still resolves — ambiguity is per package, not global",
    );
  });
});

describe("pinned versions — drift detection", () => {
  const pins: Pin[] = [
    { name: TUI, pinned: "1.3.0", source: "package.json" },
    { name: AGENT, pinned: "1.3.0", source: "pnpm-lock.yaml" },
  ];

  test("a matching install has no findings", () => {
    assert.deepEqual(diffVersions(pins, { [TUI]: "1.3.0", [AGENT]: "1.3.0" }), []);
  });

  test("the #44 stale tree is a finding, with both versions", () => {
    const mismatches = diffVersions(pins, { [TUI]: "0.84.2", [AGENT]: "0.85.1" });
    assert.equal(mismatches.length, 2);
    assert.deepEqual(mismatches[0], {
      name: TUI,
      pinned: "1.3.0",
      installed: "0.84.2",
      source: "package.json",
    });
    assert.equal(mismatches[1]?.installed, "0.85.1");
  });

  test("a missing install is a finding, not a pass", () => {
    const mismatches = diffVersions(pins, { [TUI]: null });
    assert.equal(mismatches.length, 2);
    assert.equal(mismatches[0]?.installed, null);
    assert.match(formatMismatch(mismatches[0] as never), /not installed/);
  });
});

describe("pinned versions — the message is actionable", () => {
  const stale = {
    name: TUI,
    pinned: "1.3.0",
    installed: "0.84.2",
    source: "package.json",
  };

  test("names the pinned version, the installed version and the fix", () => {
    const message = formatMismatch(stale);
    assert.match(message, /installed 0\.84\.2/);
    assert.match(message, /pinned 1\.3\.0/);
    assert.match(message, /package\.json/);
    assert.match(message, new RegExp(FIX_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(message, /looks exactly like an API change/);
  });

  test("the clean report says what matched", () => {
    assert.match(formatReport([]), /match the install/);
    for (const name of WATCHED_PACKAGES)
      assert.match(formatReport([]), new RegExp(name.replace(/[/@.]/g, "\\$&")));
  });

  test("a failing report carries every mismatch", () => {
    const report = formatReport([stale, { ...stale, name: AGENT, installed: "0.85.1" }]);
    assert.match(report, /0\.84\.2/);
    assert.match(report, /0\.85\.1/);
    assert.equal(report.split("\n").filter((line) => line.includes(FIX_COMMAND)).length, 2);
  });
});

describe("pinned versions — against this repository", () => {
  test("the checked-in tree is consistent (the guard itself cannot drift)", () => {
    const { code, report } = check(process.cwd());
    assert.equal(code, 0, `guard failed on the clean tree:\n${report}`);
    assert.match(report, /match the install/);
  });
});
