/**
 * Fixture images, generated at test time so no binary files live in the repository.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = mkdtempSync(join(tmpdir(), "pi-multiple-image-read-fixtures-"));

after(() => {
	rmSync(ROOT, { recursive: true, force: true });
});

/** A fresh subdirectory under the fixture root. */
export function fixtureDir(name: string): string {
	const dir = join(ROOT, name);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** A solid-colour PNG of the given size. The hue varies with `hue` so tiles are distinguishable. */
export function writeSolidPng(dir: string, name: string, width: number, height: number, hue = 0): string {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
	ctx.fillRect(0, 0, width, height);
	const path = join(dir, name);
	writeFileSync(path, canvas.toBuffer("image/png"));
	return path;
}

/** A PNG of pseudo-random pixels. Random pixels compress badly, so this produces the largest sheets. */
export function writeNoisePng(dir: string, name: string, width: number, height: number, seed = 1): string {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");
	const image = ctx.createImageData(width, height);
	let state = seed;
	for (let i = 0; i < image.data.length; i++) {
		state = (state * 1664525 + 1013904223) >>> 0;
		image.data[i] = state >>> 24;
	}
	ctx.putImageData(image, 0, 0);
	const path = join(dir, name);
	writeFileSync(path, canvas.toBuffer("image/png"));
	return path;
}
