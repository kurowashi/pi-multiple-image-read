/**
 * Turns the tool's path inputs (files, directories, globs) into an ordered list of image files.
 *
 * Order is the input order; inside one directory or glob, names sort naturally (`img2` before `img10`).
 * Duplicates are dropped, keeping the first occurrence.
 */

import { globSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

/** Formats the image decoder can read. TIFF is not among them. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);

/** Hard cap per call. It stops a broad glob from filling the context. */
export const MAX_IMAGES = 48;

const GLOB_CHARACTERS = /[*?[\]{}]/;

export function expandInputs(inputs: readonly string[]): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const raw of inputs) {
		const expanded = expandHome(raw);
		const hits = GLOB_CHARACTERS.test(expanded) ? matchGlob(raw, expanded) : matchPath(raw, expanded);
		for (const hit of hits) {
			const key = resolve(hit);
			if (!seen.has(key)) {
				seen.add(key);
				found.push(hit);
			}
		}
	}
	if (found.length === 0) throw new Error("no images given");
	if (found.length > MAX_IMAGES) {
		throw new Error(`${found.length} images matched; the limit is ${MAX_IMAGES} per call. Narrow the paths.`);
	}
	return found;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function matchGlob(raw: string, pattern: string): string[] {
	const hits = globSync(pattern).filter((p) => isFile(p) && isImage(p));
	if (hits.length === 0) throw new Error(`no images match: ${raw}`);
	return hits.sort(compareNatural);
}

function matchPath(raw: string, path: string): string[] {
	if (isDirectory(path)) {
		const hits = readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isFile() && isImage(entry.name))
			.map((entry) => join(path, entry.name))
			.sort(compareNatural);
		if (hits.length === 0) throw new Error(`no images in directory: ${raw}`);
		return hits;
	}
	if (isFile(path)) {
		if (!isImage(path)) throw new Error(`unsupported image type: ${raw}`);
		return [path];
	}
	throw new Error(`not found: ${raw}`);
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
