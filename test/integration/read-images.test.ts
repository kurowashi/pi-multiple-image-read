/**
 * Integration: the tool end to end, from path inputs to content blocks.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readImages } from "../../src/read-images.ts";
import { fixtureDir, writeSolidPng } from "../helpers/images.ts";

test("twenty-five images give two sheets, and the text lists every image by its number", async () => {
	const dir = fixtureDir("e2e-25");
	for (let i = 1; i <= 25; i++) writeSolidPng(dir, `shot_${String(i).padStart(2, "0")}.png`, 400, 300, i * 10);
	const blocks = await readImages([dir]);
	assert.equal(blocks.filter((b) => b.type === "image").length, 2);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.equal(text.text.match(/^ {2}\d+\. /gm)?.length, 25);
	assert.match(text.text, /^ {2}1\. .*shot_01\.png$/m);
	assert.match(text.text, /^ {2}25\. .*shot_25\.png$/m);
	assert.match(text.text, /25 image\(s\) on 2 sheet\(s\)/);
});

test("a sheet with a single image has its number on the label, and the text names the file", async () => {
	const dir = fixtureDir("e2e-one");
	writeSolidPng(dir, "only.png", 400, 300, 0);
	const blocks = await readImages([dir]);
	assert.equal(blocks.filter((b) => b.type === "image").length, 1);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /^ {2}1\. .*only\.png$/m);
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

test("a truncated label is marked in the list, and readable labels are listed without a mark", async () => {
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
	assert.match(text.text, /^ {2}1\. .*a-very-long.*\(label cut off\)$/m);
	assert.match(text.text, /^ {2}2\. .*short\.png$/m);
});

test("two files with the same name in different directories are both listed with their full paths", async () => {
	const first = fixtureDir("e2e-shared-a");
	const second = fixtureDir("e2e-shared-b");
	const a = writeSolidPng(first, "shot.png", 400, 300, 0);
	const b = writeSolidPng(second, "shot.png", 400, 300, 90);
	const blocks = await readImages([a, b]);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /^ {2}1\. .*e2e-shared-a.*shot\.png \(label shared with another file\)$/m);
	assert.match(text.text, /^ {2}2\. .*e2e-shared-b.*shot\.png \(label shared with another file\)$/m);
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

test("a glob that matches no file of one type is listed as skipped, and the other types still come back", async () => {
	const dir = fixtureDir("e2e-no-jpg");
	writeSolidPng(dir, "a.png", 100, 100, 0);
	writeSolidPng(dir, "b.png", 100, 100, 90);
	const blocks = await readImages([join(dir, "*.png"), join(dir, "*.jpg"), join(dir, "*.jpeg")]);
	assert.equal(blocks.filter((b) => b.type === "image").length, 1);
	const text = blocks.at(-1);
	assert.ok(text?.type === "text");
	assert.match(text.text, /2 image\(s\) on 1 sheet\(s\)/);
	assert.match(
		text.text,
		/skipped: .*\*\.jpg \(no image matches \(globs are not regular expressions; pass a directory\)\)/,
	);
	assert.match(
		text.text,
		/skipped: .*\*\.jpeg \(no image matches \(globs are not regular expressions; pass a directory\)\)/,
	);
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

test("more than one page: the first page names the next offset, and the last page says it is the end", async () => {
	const dir = fixtureDir("e2e-paging");
	for (let i = 1; i <= 50; i++) writeSolidPng(dir, `p${String(i).padStart(2, "0")}.png`, 40, 40, i);
	const first = await readImages([dir]);
	const firstText = first.at(-1);
	assert.ok(firstText?.type === "text");
	assert.match(firstText.text, /Showing inputs 1-25 of 50\. For the rest, call again with offset 25\./);

	const second = await readImages([dir], { offset: 25 });
	const secondText = second.at(-1);
	assert.ok(secondText?.type === "text");
	assert.match(secondText.text, /Showing inputs 26-50 of 50\./);
	assert.doesNotMatch(secondText.text, /call again/);
});

test("49 images never leave a single image alone on a page or sheet", async () => {
	const dir = fixtureDir("e2e-49");
	for (let i = 1; i <= 49; i++) writeSolidPng(dir, `q${String(i).padStart(2, "0")}.png`, 400, 300, i);
	const first = await readImages([dir]);
	const firstText = first.at(-1);
	assert.ok(firstText?.type === "text");
	assert.match(firstText.text, /Showing inputs 1-25 of 49\. For the rest, call again with offset 25\./);
	assert.match(firstText.text, /25 image\(s\) on 2 sheet\(s\)/);
	const second = await readImages([dir], { offset: 25 });
	const secondText = second.at(-1);
	assert.ok(secondText?.type === "text");
	assert.match(secondText.text, /24 image\(s\) on 1 sheet\(s\)/);
});

test("a shared label is the same on every page, because labels are decided over all inputs", async () => {
	const a = fixtureDir("e2e-paging-shared-a");
	const b = fixtureDir("e2e-paging-shared-b");
	for (let i = 1; i <= 49; i++) writeSolidPng(a, `p${String(i).padStart(2, "0")}.png`, 400, 300, i);
	writeSolidPng(b, "p49.png", 400, 300, 0);
	// a/p49.png is image 49 (page 2), and b/p49.png is image 50 (page 2) too; both share the stem "p49".
	const onPage2 = await readImages([a, b], { offset: 48 });
	const text = onPage2.at(-1);
	assert.ok(text?.type === "text");
	// Both files are on page 2, so the list must name each file with its real path, not an empty string.
	// Positions are input positions: the two images are 49 and 50 of 50, not 1 and 2 of the page.
	assert.match(text.text, /^ {2}49\. .*e2e-paging-shared-a.*p49\.png \(label shared with another file\)$/m);
	assert.match(text.text, /^ {2}50\. .*e2e-paging-shared-b.*p49\.png \(label shared with another file\)$/m);
	assert.doesNotMatch(text.text, /\d+\. {2}\(/, "no listed line may lack a path");
});

test("an offset past the last image is an error that says how many were found", async () => {
	const dir = fixtureDir("e2e-paging-past");
	writeSolidPng(dir, "only.png", 40, 40, 0);
	await assert.rejects(readImages([dir], { offset: 5 }), /offset 5 is past the last image \(1 found\)/);
});
