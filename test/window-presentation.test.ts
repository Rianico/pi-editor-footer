import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { decorateWindow, type WindowThemeLike } from "../src/window-presentation.js";

const RED = "\x1b[31m";
const RESET = "\x1b[39m";

/** Mock theme emitting REAL ANSI sequences, like pi's Theme does. */
function makeTheme(): WindowThemeLike {
	return {
		border: (s) => `${RED}${s}${RESET}`,
		highlight: (s) => `${RED}${s}${RESET}`,
		dim: (s) => `${RED}${s}${RESET}`,
	};
}

describe("decorateWindow", () => {
	test("returns [] for empty input (window hidden)", () => {
		assert.deepEqual(decorateWindow([], 40, makeTheme()), []);
	});

	test("builds a bordered box: border, header, body, border", () => {
		const out = decorateWindow(["grilling · skill", "Interview users"], 20, makeTheme());
		assert.equal(out.length, 4);
		// top/bottom borders: ┌ + (width-2) ─ + ┐
		assert.equal(out[0], `┌${RED}${"─".repeat(18)}${RESET}┐`);
		assert.equal(out[3], `└${RED}${"─".repeat(18)}${RESET}┘`);
		// header row: highlighted header (16 cols = inner width, no pad)
		assert.equal(out[1], `│ ${RED}grilling · skill${RESET} │`);
		// body row: dim description (15 cols, padded by 1 + the row's suffix space)
		assert.equal(out[2], `│ ${RED}Interview users${RESET}  │`);
	});

	test("every row is exactly `width` columns (ANSI-aware padding)", () => {
		const out = decorateWindow(["a · b", "line"], 12, makeTheme());
		for (const row of out) {
			assert.equal(visibleWidth(row), 12, `row ${JSON.stringify(row)} not 12 wide`);
		}
	});

	test("padTo is ANSI-aware: styled content padded to inner width", () => {
		// "a · b" (5 cols) padded to inner width (8) — 3 trailing spaces AFTER the reset
		const out = decorateWindow(["a · b", "line"], 12, makeTheme());
		assert.equal(out[1], `│ ${RED}a · b${RESET}    │`);
	});

	test("short content pads, long content does not crash (clamped pad)", () => {
		const out = decorateWindow(["label · kind", "short"], 10, makeTheme());
		assert.equal(out.length, 4);
		assert.ok(out[1].includes("label · kind"));
	});

	test("header uses highlight, body uses dim, borders use border style", () => {
		const out = decorateWindow(["h", "d1", "d2"], 8, makeTheme());
		assert.ok(out[1].startsWith(`│ ${RED}h${RESET}`));
		assert.ok(out[2].startsWith(`│ ${RED}d1${RESET}`));
		assert.ok(out[3].startsWith(`│ ${RED}d2${RESET}`));
		assert.ok(out[0].startsWith(`┌${RED}`));
		assert.ok(out[out.length - 1].startsWith(`└${RED}`));
	});
});
