/**
 * Regenerates the README picture: 24 generated illustrations, run through the tool's own `readImages`,
 * with the first sheet saved to docs/images/. The illustrations are drawn from a fixed seed, so the same
 * command always gives the same picture. They are drawn here, not taken from anywhere, so no third-party
 * licence applies.
 *
 * Usage: node scripts/make-readme-sheet.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { readImages } from "../src/read-images.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const OUT = join(ROOT, "docs", "images", "read-images-sheet.png");

/** 24 names: Latin and Japanese, so the README shows both label styles. */
const NAMES = [
	"sunrise",
	"ocean",
	"forest",
	"夕焼け",
	"city",
	"snowpeak",
	"desert",
	"night-sky",
	"meadow",
	"街並み",
	"lake",
	"canyon",
	"harbor",
	"海辺",
	"autumn",
	"glacier",
	"river",
	"月夜",
	"valley",
	"island",
	"bamboo",
	"dusk",
	"tundra",
	"朝霧",
];

/** Mulberry32: a small seeded generator, so each illustration is the same on every run. */
function rng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Draws one abstract landscape: a sky gradient, a sun or moon, and layered hills. */
function draw(seed: number): Buffer {
	const next = rng(seed);
	const w = 480;
	const h = 320;
	const canvas = createCanvas(w, h);
	const ctx = canvas.getContext("2d");

	const hue = Math.floor(next() * 360);
	const sky = ctx.createLinearGradient(0, 0, 0, h);
	sky.addColorStop(0, `hsl(${hue}, 60%, 28%)`);
	sky.addColorStop(1, `hsl(${(hue + 40) % 360}, 80%, 70%)`);
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, w, h);

	ctx.fillStyle = `hsl(${(hue + 180) % 360}, 90%, 85%)`;
	ctx.beginPath();
	ctx.arc(w * (0.2 + next() * 0.6), h * (0.2 + next() * 0.25), 22 + next() * 26, 0, Math.PI * 2);
	ctx.fill();

	for (let layer = 0; layer < 4; layer++) {
		const base = h * (0.45 + layer * 0.15);
		ctx.fillStyle = `hsl(${(hue + layer * 25) % 360}, ${35 + layer * 12}%, ${38 - layer * 7}%)`;
		ctx.beginPath();
		ctx.moveTo(0, h);
		for (let x = 0; x <= w; x += 24) {
			const y = base - next() * 70 * (1 - layer * 0.15);
			ctx.lineTo(x, y);
		}
		ctx.lineTo(w, h);
		ctx.closePath();
		ctx.fill();
	}
	return canvas.toBuffer("image/png");
}

const dir = mkdtempSync(join(tmpdir(), "pi-mir-readme-"));
try {
	NAMES.forEach((name, i) => {
		writeFileSync(join(dir, `${name}.png`), draw(i + 1));
	});

	const blocks = await readImages([dir]);
	const sheet = blocks.find((block) => block.type === "image");
	if (sheet?.type !== "image") throw new Error("readImages returned no sheet");
	mkdirSync(join(ROOT, "docs", "images"), { recursive: true });
	writeFileSync(OUT, Buffer.from(sheet.data, "base64"));
	const reply = blocks.find((block) => block.type === "text");
	console.log(`wrote ${OUT}`);
	if (reply?.type === "text") console.log(reply.text);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
