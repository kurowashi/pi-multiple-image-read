/**
 * Unit: turning path inputs into an ordered list of image files.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compareNatural, expandInputs } from "../../src/files.ts";
import { fixtureDir, writeSolidPng } from "../helpers/images.ts";

test("natural order puts img2 before img10", () => {
	const names = ["img10.png", "img2.png", "img1.png"];
	assert.deepEqual([...names].sort(compareNatural), ["img1.png", "img2.png", "img10.png"]);
});

test("natural order is case-insensitive and stable for equal keys", () => {
	assert.ok(compareNatural("/a/B.png", "/a/a.png") > 0);
	assert.equal(compareNatural("/a/x.png", "/a/x.png"), 0);
});

test("a directory contributes its images in natural order, ignoring non-image files", () => {
	const dir = fixtureDir("dir-order");
	writeSolidPng(dir, "shot10.png", 10, 10);
	writeSolidPng(dir, "shot2.png", 10, 10);
	writeFileSync(join(dir, "notes.txt"), "not an image");
	const expanded = expandInputs([dir]);
	assert.deepEqual(
		expanded.paths.map((p) => p.split("/").pop()),
		["shot2.png", "shot10.png"],
	);
	assert.deepEqual(expanded.skipped, []);
});

test("a TIFF in a directory is skipped with a reason, not dropped silently", () => {
	const dir = fixtureDir("dir-tiff");
	writeSolidPng(dir, "a.png", 10, 10);
	writeFileSync(join(dir, "scan.tif"), "not decoded");
	const expanded = expandInputs([dir]);
	assert.deepEqual(
		expanded.paths.map((p) => p.split("/").pop()),
		["a.png"],
	);
	assert.deepEqual(
		expanded.skipped.map((s) => [s.path.split("/").pop(), s.reason]),
		[["scan.tif", "unsupported image type"]],
	);
});

test("a directory holding only TIFFs fails, and names the skipped files", () => {
	const dir = fixtureDir("dir-only-tiff");
	writeFileSync(join(dir, "scan.tiff"), "not decoded");
	assert.throws(() => expandInputs([dir]), /no readable images; skipped: .*scan\.tiff/);
});

test("a glob matches files and keeps only image types", () => {
	const dir = fixtureDir("glob");
	writeSolidPng(dir, "a.png", 10, 10);
	writeSolidPng(dir, "b.png", 10, 10);
	writeFileSync(join(dir, "c.md"), "x");
	const found = expandInputs([join(dir, "*")]).paths;
	assert.equal(found.length, 2);
});

test("the same file named twice, directly or through a directory, appears once", () => {
	const dir = fixtureDir("dedup");
	const path = writeSolidPng(dir, "one.png", 10, 10);
	assert.deepEqual(expandInputs([path, path]).paths, [path]);
	assert.deepEqual(expandInputs([path, dir]).paths, [path]);
});

test("input order is kept across entries", () => {
	const dir = fixtureDir("input-order");
	const late = writeSolidPng(dir, "late.png", 10, 10);
	const early = writeSolidPng(dir, "early.png", 10, 10);
	assert.deepEqual(expandInputs([late, early]).paths, [late, early]);
});

test("an explicit file of an unsupported type is rejected with its name", () => {
	const dir = fixtureDir("unsupported");
	const path = join(dir, "scan.tiff");
	writeFileSync(path, "x");
	assert.throws(() => expandInputs([path]), /unsupported image type: .*scan\.tiff/);
});

test("a missing path alone is an error that names it", () => {
	assert.throws(
		() => expandInputs(["/no/such/file.png"]),
		/no readable images; skipped: \/no\/such\/file\.png \(not found\)/,
	);
});

test("a missing path beside a readable input is listed as skipped, and the rest are kept", () => {
	const dir = fixtureDir("missing-beside");
	const path = writeSolidPng(dir, "one.png", 10, 10);
	const expanded = expandInputs([path, "/no/such/file.png"]);
	assert.deepEqual(expanded.paths, [path]);
	assert.deepEqual(expanded.skipped, [{ path: "/no/such/file.png", reason: "not found" }]);
});

test("a glob with no matches beside a readable input is listed as skipped by its pattern", () => {
	const dir = fixtureDir("glob-beside");
	const path = writeSolidPng(dir, "a.png", 10, 10);
	const pattern = join(dir, "*.jpg");
	const expanded = expandInputs([join(dir, "*.png"), pattern]);
	assert.deepEqual(expanded.paths, [path]);
	assert.deepEqual(expanded.skipped, [
		{ path: pattern, reason: "no image matches (globs are not regular expressions; pass a directory)" },
	]);
});

test("when no input yields an image, the call fails and names each skipped input", () => {
	assert.throws(
		() => expandInputs(["/no/such/dir/*.png"]),
		/no readable images; skipped: \/no\/such\/dir\/\*\.png \(no image matches \(globs are not regular expressions; pass a directory\)\)/,
	);
});

test("an empty directory is skipped with its reason, not an empty result", () => {
	const dir = fixtureDir("empty");
	mkdirSync(join(dir, "sub"), { recursive: true });
	assert.throws(() => expandInputs([dir]), /no images in directory/);
	const path = writeSolidPng(fixtureDir("empty-beside"), "one.png", 10, 10);
	assert.deepEqual(expandInputs([path, dir]).skipped, [{ path: dir, reason: "no images in directory" }]);
});

test("no inputs is an error", () => {
	assert.throws(() => expandInputs([]), /no images given/);
});

test("expansion returns every match, however many; the per-call page is applied later", () => {
	const dir = fixtureDir("over-cap");
	for (let i = 0; i <= 48; i++) writeSolidPng(dir, `img${i}.png`, 4, 4);
	assert.equal(expandInputs([dir]).paths.length, 49, "paging, not expansion, applies the per-call size");
});
