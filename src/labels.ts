/**
 * Tile labels: which text goes on each tile, and how it fits the tile's label band.
 *
 * Functions take a `measure` callback instead of a canvas, so the fitting rules are testable without pixels.
 */

import { parse } from "node:path";
import { MIN_FONT } from "./layout.ts";

/** A label as it will be drawn: the text, the font size, and whether the text was cut short. */
export interface FittedLabel {
	text: string;
	px: number;
	truncated: boolean;
}

/**
 * Label per file: the file stem, or the full file name when two files share a stem.
 * The stem alone is what the model reads first, so it is preferred whenever it is unambiguous.
 */
export function tileLabels(paths: readonly string[]): string[] {
	const stemCount = new Map<string, number>();
	for (const path of paths) {
		const stem = parse(path).name;
		stemCount.set(stem, (stemCount.get(stem) ?? 0) + 1);
	}
	return paths.map((path) => {
		const { name, base } = parse(path);
		return stemCount.get(name) === 1 ? name : base;
	});
}

/**
 * Shrink the font down to MIN_FONT, then truncate with an ellipsis, so a label never spills into a neighbour.
 * Returns null when not even the ellipsis fits.
 */
export function fitLabel(
	text: string,
	maxWidth: number,
	startPx: number,
	measure: (text: string, px: number) => number,
): FittedLabel | null {
	let px = startPx;
	while (px > MIN_FONT && measure(text, px) > maxWidth) px--;
	if (measure(text, px) <= maxWidth) return { text, px, truncated: false };

	// Code points, not UTF-16 units, so a surrogate pair is never split.
	const chars = [...text];
	while (chars.length > 0 && measure(`${chars.join("")}…`, px) > maxWidth) chars.pop();
	if (chars.length === 0) return measure("…", px) <= maxWidth ? { text: "…", px, truncated: true } : null;
	return { text: `${chars.join("")}…`, px, truncated: true };
}

/**
 * Non-ASCII text needs a CJK-capable font, or it would be drawn as empty boxes.
 * Without one, the label is left off the tile and the reply names the file instead.
 */
export function canDrawLabel(text: string, hasCjkFamily: boolean): boolean {
	return hasCjkFamily || Array.from(text).every((char) => char.charCodeAt(0) < 0x80);
}
