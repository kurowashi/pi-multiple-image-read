/**
 * Unit: sheet composition and encoding, using real canvas output.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCanvas, type Image, loadImage } from "@napi-rs/canvas";
import { MAX_EDGE } from "../../src/layout.ts";
import { anyTileTooSmall, b64Length, composeSheet, encode, INLINE_B64_MAX } from "../../src/render.ts";
import { fixtureDir, writeNoisePng, writeSolidPng } from "../helpers/images.ts";

async function load(path: string): Promise<Image> {
	return loadImage(readFileSync(path));
}

function noiseCanvas(size: number, seed: number) {
	const canvas = createCanvas(size, size);
	const ctx = canvas.getContext("2d");
	const image = ctx.createImageData(size, size);
	let state = seed;
	for (let i = 0; i < image.data.length; i++) {
		state = (state * 1664525 + 1013904223) >>> 0;
		image.data[i] = state >>> 24;
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}

test("b64Length matches base64 output for every remainder", () => {
	for (let n = 0; n < 10; n++) {
		assert.equal(b64Length(n), Buffer.from(new Uint8Array(n)).toString("base64").length);
	}
});

test("a sheet is PNG when it fits the inline limit", async () => {
	const dir = fixtureDir("render-png");
	const items = [
		{ number: 1, name: "a", image: await load(writeSolidPng(dir, "a.png", 300, 200, 10)) },
		{ number: 2, name: "b", image: await load(writeSolidPng(dir, "b.png", 200, 300, 200)) },
	];
	const sheet = composeSheet(items, null);
	assert.equal(sheet.mimeType, "image/png");
	assert.ok(b64Length(Buffer.from(sheet.data, "base64").length) <= INLINE_B64_MAX);
});

test("a noise sheet at the maximum size falls back to JPEG under the inline limit", () => {
	const encoded = encode(noiseCanvas(MAX_EDGE, 7));
	assert.equal(encoded.mimeType, "image/jpeg");
	assert.ok(b64Length(Buffer.from(encoded.data, "base64").length) <= INLINE_B64_MAX);
});

test("a sheet built from noisy images stays under the inline limit", async () => {
	const dir = fixtureDir("render-noise");
	const items = [];
	for (let i = 0; i < 12; i++) {
		items.push({ number: i + 1, name: `n${i}`, image: await load(writeNoisePng(dir, `n${i}.png`, 700, 700, i + 3)) });
	}
	const sheet = composeSheet(items, null);
	assert.ok(b64Length(Buffer.from(sheet.data, "base64").length) <= INLINE_B64_MAX);
});

test("every tile reports its size and that its label was drawn", async () => {
	const dir = fixtureDir("render-tiles");
	const items = [
		{ number: 1, name: "wide", image: await load(writeSolidPng(dir, "wide.png", 800, 400, 40)) },
		{ number: 2, name: "tall", image: await load(writeSolidPng(dir, "tall.png", 400, 800, 120)) },
	];
	const sheet = composeSheet(items, null);
	assert.equal(sheet.tiles.length, 2);
	for (const tile of sheet.tiles) {
		assert.ok(tile.width > 0 && tile.height > 0, "tile size must be positive");
		assert.equal(tile.label, "drawn");
	}
});

test("non-ASCII labels are not drawn without a CJK font, and the tile says so", async () => {
	const dir = fixtureDir("render-no-cjk");
	const items = [{ number: 1, name: "写真", image: await load(writeSolidPng(dir, "jp.png", 300, 300, 10)) }];
	const sheet = composeSheet(items, null);
	assert.equal(sheet.tiles[0]?.label, "not-drawn");
});

test("tiles under the readable minimum are flagged", () => {
	assert.equal(anyTileTooSmall([{ index: 0, label: "drawn", width: 100, height: 400 }]), true);
	assert.equal(anyTileTooSmall([{ index: 0, label: "drawn", width: 400, height: 400 }]), false);
});
