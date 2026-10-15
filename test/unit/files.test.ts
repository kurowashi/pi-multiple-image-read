/**
 * Unit: turning path inputs into an ordered list of image files.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compareNatural, expandInputs, MAX_IMAGES } from "../../src/files.ts";
import { fixtureDir, writeSolidPng } from "../helpers/images.ts";

test("natural order puts img2 before img10", () => {
	const names = ["img10.png", "img2.png", "img1.png"];
	assert.deepEqual([...names].sort(compareNatural), ["img1.png", "img2.png", "img10.png"]);
});

test("natural order is case-insensitive and stable for equal keys", () => {
	assert.ok(compareNatural("/a/B.png", "/a/a.png") > 0);
	assert.equal(compareNatural("/a/x.png", "/a/x.png"), 0);
});

test("a directory contributes its images in natural order, skipping other files", () => {
	const dir = fixtureDir("dir-order");
	writeSolidPng(dir, "shot10.png", 10, 10);
	writeSolidPng(dir, "shot2.png", 10, 10);
	writeFileSync(join(dir, "notes.txt"), "not an image");
	writeFileSync(join(dir, "tiff.tif"), "not decoded");
	const found = expandInputs([dir]);
	assert.deepEqual(
		found.map((p) => p.split("/").pop()),
		["shot2.png", "shot10.png"],
	);
});

test("a glob matches files and keeps only image types", () => {
	const dir = fixtureDir("glob");
	writeSolidPng(dir, "a.png", 10, 10);
	writeSolidPng(dir, "b.png", 10, 10);
	writeFileSync(join(dir, "c.md"), "x");
	const found = expandInputs([join(dir, "*")]);
	assert.equal(found.length, 2);
});

test("the same file named twice, directly or through a directory, appears once", () => {
	const dir = fixtureDir("dedup");
	const path = writeSolidPng(dir, "one.png", 10, 10);
	assert.deepEqual(expandInputs([path, path]), [path]);
	assert.deepEqual(expandInputs([path, dir]), [path]);
});

test("input order is kept across entries", () => {
	const dir = fixtureDir("input-order");
	const late = writeSolidPng(dir, "late.png", 10, 10);
	const early = writeSolidPng(dir, "early.png", 10, 10);
	assert.deepEqual(expandInputs([late, early]), [late, early]);
});

test("an explicit file of an unsupported type is rejected with its name", () => {
	const dir = fixtureDir("unsupported");
	const path = join(dir, "scan.tiff");
	writeFileSync(path, "x");
	assert.throws(() => expandInputs([path]), /unsupported image type: .*scan\.tiff/);
});

test("a missing path is reported by name", () => {
	assert.throws(() => expandInputs(["/no/such/file.png"]), /not found: \/no\/such\/file\.png/);
});

test("a glob with no matches is reported by its pattern", () => {
	assert.throws(() => expandInputs(["/no/such/dir/*.png"]), /no images match: \/no\/such\/dir\/\*\.png/);
});

test("an empty directory is an error, not an empty result", () => {
	const dir = fixtureDir("empty");
	mkdirSync(join(dir, "sub"), { recursive: true });
	assert.throws(() => expandInputs([dir]), /no images in directory/);
});

test("no inputs is an error", () => {
	assert.throws(() => expandInputs([]), /no images given/);
});

test("more than the per-call cap is refused, and the message says how many matched", () => {
	const dir = fixtureDir("over-cap");
	for (let i = 0; i <= MAX_IMAGES; i++) writeSolidPng(dir, `img${i}.png`, 4, 4);
	assert.throws(() => expandInputs([dir]), new RegExp(`${MAX_IMAGES + 1} images matched`));
});
