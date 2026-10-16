/**
 * Unit: tile labels and label fitting.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { canDrawLabel, fitLabel, tileLabels } from "../../src/labels.ts";
import { MIN_FONT } from "../../src/layout.ts";

/** Measure text as 0.6 em per character. Deterministic and independent of any font. */
const measure = (text: string, px: number): number => Array.from(text).length * px * 0.6;

test("a label is the file stem when stems are unique", () => {
	assert.deepEqual(tileLabels(["/a/shot_01.png", "/b/shot_02.jpg"]), ["shot_01", "shot_02"]);
});

test("labels keep the full file name when two stems collide", () => {
	assert.deepEqual(tileLabels(["/a/shot.png", "/b/shot.jpg", "/c/other.png"]), ["shot.png", "shot.jpg", "other"]);
});

test("a short label fits at the starting size, untruncated", () => {
	const fitted = fitLabel("shot_01", 400, 20, measure);
	assert.deepEqual(fitted, { text: "shot_01", px: 20, truncated: false });
});

test("a long label shrinks before it is truncated", () => {
	const fitted = fitLabel("abcdefghijkl", 120, 40, measure);
	assert.ok(fitted, "a label must be returned");
	assert.equal(fitted.truncated, false, "shrinking alone should fit this label");
	assert.ok(fitted.px < 40 && fitted.px >= MIN_FONT);
});

test("a label that cannot fit even at the minimum size is truncated with an ellipsis", () => {
	const fitted = fitLabel("a".repeat(200), 80, 20, measure);
	assert.ok(fitted);
	assert.equal(fitted.truncated, true);
	assert.equal(fitted.px, MIN_FONT);
	assert.ok(fitted.text.includes("…"));
	assert.ok(measure(fitted.text, MIN_FONT) <= 80);
});

test("truncation counts code points, so Japanese is never split mid-character", () => {
	const original = "写真テストの長い名前のファイル";
	const fitted = fitLabel(original, 60, 20, measure);
	assert.ok(fitted);
	assert.equal(fitted.truncated, true);
	assert.ok(fitted.text.isWellFormed(), "no lone surrogates");
	const [head, tail] = fitted.text.split("…");
	assert.ok(original.startsWith(head ?? ""), "the head is a prefix of the original, cut on character boundaries");
	assert.ok(original.endsWith(tail ?? ""), "the tail is a suffix of the original, cut on character boundaries");
});

test("truncation keeps the end, so numbered names stay distinguishable", () => {
	const fitted = fitLabel("スクリーンショット_2025-03-14_10.23.45_01", 120, 20, measure);
	assert.ok(fitted);
	assert.equal(fitted.truncated, true);
	assert.ok(fitted.text.endsWith("01"), `expected the end to survive, got ${fitted.text}`);
});

test("nothing fits in a zero-width tile, so there is no label", () => {
	assert.equal(fitLabel("shot", 0, 20, measure), null);
});

test("ASCII labels are always drawable", () => {
	assert.ok(canDrawLabel("shot_01", false));
});

test("non-ASCII labels need a CJK-capable font", () => {
	assert.equal(canDrawLabel("写真.png", false), false);
	assert.ok(canDrawLabel("写真.png", true));
});
