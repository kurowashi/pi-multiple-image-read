/**
 * Integration: the tool end to end, from path inputs to content blocks.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readImages } from "../../src/read-images.ts";
import { fixtureDir, writeSolidPng } from "../helpers/images.ts";

test("fifteen images that all have readable labels give two sheets and no text block", async () => {
	const dir = fixtureDir("e2e-15");
	for (let i = 1; i <= 15; i++) writeSolidPng(dir, `shot_${String(i).padStart(2, "0")}.png`, 400, 300, i * 20);
	const blocks = await readImages([dir]);
	assert.equal(blocks.filter((b) => b.type === "image").length, 2);
	assert.equal(
		blocks.some((b) => b.type === "text"),
		false,
	);
});

test("the text block, when present, comes after every image", async () => {
	const dir = fixtureDir("e2e-order");
	writeSolidPng(
		dir,
		"a-very-long-file-name-that-cannot-possibly-fit-on-a-small-tile-in-any-sheet-layout-here.png",
		400,
		300,
		0,
	);
	writeSolidPng(dir, "b.png", 100, 100, 90);
	const blocks = await readImages([dir]);
	assert.equal(blocks.at(-1)?.type, "text");
	assert.ok(blocks.slice(0, -1).every((b) => b.type === "image"));
});

test("a truncated label is listed by position, and readable labels are not", async () => {
	const dir = fixtureDir("e2e-cut");
	writeSolidPng(dir, "short.png", 400, 300, 0);
	writeSolidPng(
		dir,
		"a-very-long-file-name-that-cannot-possibly-fit-on-a-small-tile-in-any-sheet-layout-here.png",
		400,
		300,
		90,
	);
	const blocks = await readImages([dir]);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /1\. .*a-very-long.*\(label cut off\)/);
	assert.doesNotMatch(text.text, /short\.png/);
});

test("two files with the same name in different directories are both listed as shared", async () => {
	const first = fixtureDir("e2e-shared-a");
	const second = fixtureDir("e2e-shared-b");
	const a = writeSolidPng(first, "shot.png", 400, 300, 0);
	const b = writeSolidPng(second, "shot.png", 400, 300, 90);
	const blocks = await readImages([a, b]);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /1\. .*e2e-shared-a.*shot\.png \(label shared with another file\)/);
	assert.match(text.text, /2\. .*e2e-shared-b.*shot\.png \(label shared with another file\)/);
});

test("without a CJK font, a Japanese file name is listed but its label is not drawn", async () => {
	const dir = fixtureDir("e2e-no-cjk");
	writeSolidPng(dir, "写真.png", 400, 300, 0);
	const blocks = await readImages([dir], { fontFamily: null });
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /写真\.png \(label not drawn\)/);
	assert.match(text.text, /No Japanese-capable font is installed/);
});

test("an unreadable file is listed as skipped, and the other images still come back", async () => {
	const dir = fixtureDir("e2e-broken");
	writeSolidPng(dir, "a-ok.png", 100, 100, 0);
	writeFileSync(join(dir, "broken.png"), "not an image");
	writeSolidPng(dir, "c-ok.png", 100, 100, 90);
	const blocks = await readImages([dir]);
	assert.equal(blocks.filter((b) => b.type === "image").length, 1);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /2 image\(s\) on 1 sheet\(s\)/);
	assert.match(text.text, /skipped: .*broken\.png \(cannot decode: /);
});

test("a TIFF in a directory is listed as skipped, with its reason", async () => {
	const dir = fixtureDir("e2e-tiff");
	writeSolidPng(dir, "a.png", 100, 100, 0);
	writeFileSync(join(dir, "scan.tif"), "not decoded");
	const blocks = await readImages([dir]);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /skipped: .*scan\.tif \(unsupported image type\)/);
});

test("when no file can be read, the call fails and lists why", async () => {
	const dir = fixtureDir("e2e-all-broken");
	writeFileSync(join(dir, "broken.png"), "not an image");
	await assert.rejects(readImages([dir]), /no readable images: .*broken\.png \(cannot decode: /);
});

test("a tiny tile produces the readability note", async () => {
	const dir = fixtureDir("e2e-small");
	writeSolidPng(dir, "wide.png", 4000, 40, 0);
	writeSolidPng(dir, "tall.png", 40, 4000, 90);
	const blocks = await readImages([dir]);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /hard to read/);
});
