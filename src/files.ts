/**
 * Turns the tool's path inputs (files, directories, globs) into an ordered list of image files.
 *
 * Order is the input order; inside one directory or glob, names sort naturally (`img2` before `img10`).
 * Duplicates are dropped, keeping the first occurrence.
 */

import { globSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

/** Formats the image decoder can read. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);

/**
 * Image formats the decoder is known to reject (measured: loadImage fails on TIFF).
 * Directory and glob hits of these are listed as skipped rather than dropped silently.
 */
const UNSUPPORTED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([".tif", ".tiff"]);

/** A file that matched the inputs but will not be read, and the reason. */
export interface Skipped {
	path: string;
	reason: string;
}

export interface Expanded {
	paths: string[];
	skipped: Skipped[];
}

interface Matched {
	images: string[];
	skipped: Skipped[];
}

const GLOB_CHARACTERS = /[*?[\]{}]/;

export function expandInputs(inputs: readonly string[]): Expanded {
	const collector = new Collector();
	for (const raw of inputs) {
		const expanded = expandHome(raw);
		const matched = GLOB_CHARACTERS.test(expanded) ? matchGlob(raw, expanded) : matchPath(raw, expanded);
		collector.add(matched);
	}
	const { found, skipped } = collector;
	if (found.length === 0) {
		if (skipped.length > 0) throw new Error(`no readable images; skipped: ${skipped.map((s) => s.path).join(", ")}`);
		throw new Error("no images given");
	}
	return { paths: found, skipped };
}

/** Collects matches across inputs, keeping the first occurrence of each file. */
class Collector {
	readonly found: string[] = [];
	readonly skipped: Skipped[] = [];
	private readonly seen = new Set<string>();

	add(matched: Matched): void {
		for (const hit of matched.images) {
			if (this.firstTime(hit)) this.found.push(hit);
		}
		for (const skip of matched.skipped) {
			if (this.firstTime(skip.path)) this.skipped.push(skip);
		}
	}

	private firstTime(path: string): boolean {
		const key = resolve(path);
		if (this.seen.has(key)) return false;
		this.seen.add(key);
		return true;
	}
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function matchGlob(raw: string, pattern: string): Matched {
	const files = globSync(pattern).filter(isFile).sort(compareNatural);
	const matched = split(files);
	if (matched.images.length === 0 && matched.skipped.length === 0) throw new Error(`no images match: ${raw}`);
	return matched;
}

function matchPath(raw: string, path: string): Matched {
	if (isDirectory(path)) {
		const files = readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => join(path, entry.name))
			.sort(compareNatural);
		const matched = split(files);
		if (matched.images.length === 0 && matched.skipped.length === 0) throw new Error(`no images in directory: ${raw}`);
		return matched;
	}
	if (isFile(path)) {
		if (!isImage(path)) throw new Error(`unsupported image type: ${raw}`);
		return { images: [path], skipped: [] };
	}
	throw new Error(`not found: ${raw}`);
}

/** Separates readable images from unsupported image formats. Other files are not images and are ignored. */
function split(files: readonly string[]): Matched {
	const images = files.filter(isImage);
	const skipped = files
		.filter((path) => UNSUPPORTED_IMAGE_EXTENSIONS.has(extname(path).toLowerCase()))
		.map((path) => ({ path, reason: "unsupported image type" }));
	return { images, skipped };
}

function isImage(path: string): boolean {
	return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function isFile(path: string): boolean {
	return statOrNull(path)?.isFile() ?? false;
}

function isDirectory(path: string): boolean {
	return statOrNull(path)?.isDirectory() ?? false;
}

function statOrNull(path: string) {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

/** Sort key for natural order: digit runs compare as numbers. */
function naturalKey(name: string): (string | number)[] {
	return name.split(/(\d+)/).map((token, i) => (i % 2 === 1 ? Number(token) : token.toLowerCase()));
}

export function compareNatural(a: string, b: string): number {
	const left = naturalKey(basename(a));
	const right = naturalKey(basename(b));
	for (const [i, x] of left.entries()) {
		const y = right[i];
		if (y === undefined) return 1;
		if (x === y) continue;
		if (typeof x === "number" && typeof y === "number") return x - y;
		return String(x) < String(y) ? -1 : 1;
	}
	return left.length - right.length;
}
