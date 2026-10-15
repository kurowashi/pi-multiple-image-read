/**
 * Integration: the tool end to end, from path inputs to content blocks.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readImages } from "../../src/read-images.ts";
import { fixtureDir, writeSolidPng } from "../helpers/images.ts";

test("fifteen images give two sheets, the first full, and a text index in input order", async () => {
	const dir = fixtureDir("e2e-15");
	for (let i = 1; i <= 15; i++) writeSolidPng(dir, `shot_${String(i).padStart(2, "0")}.png`, 400, 300, i * 20);
	const blocks = await readImages([dir]);
	const images = blocks.filter((b) => b.type === "image");
	const text = blocks.find((b) => b.type === "text");
	assert.equal(images.length, 2);
	assert.ok(text?.type === "text");
	assert.match(text.text, /^15 image\(s\) on 2 sheet\(s\), in input order/);
	assert.match(text.text, /Sheet 1 \(positions 1-12\)/);
	assert.match(text.text, /Sheet 2 \(positions 13-15\)/);
	assert.match(text.text, /13\. .*shot_13\.png/);
});

test("the text block is always last, after every image", async () => {
	const dir = fixtureDir("e2e-order");
	writeSolidPng(dir, "a.png", 100, 100, 0);
	const blocks = await readImages([dir]);
	assert.equal(blocks.at(-1)?.type, "text");
	assert.ok(blocks.slice(0, -1).every((b) => b.type === "image"));
});

test("a truncated label is named in the text block, by position", async () => {
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

test("a single unreadable file fails the whole call and names the file", async () => {
	const dir = fixtureDir("e2e-broken");
	writeSolidPng(dir, "ok.png", 100, 100, 0);
	const broken = join(dir, "broken.png");
	writeFileSync(broken, "not an image");
	await assert.rejects(readImages([dir]), /cannot read .*broken\.png/);
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
