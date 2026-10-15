/**
 * The tool's work: resolve the inputs, decode images in input order, pack them into sheets, and describe the result.
 */

import { readFileSync } from "node:fs";
import { type Image, loadImage } from "@napi-rs/canvas";
import { expandInputs } from "./files.ts";
import { findCjkFamily } from "./font.ts";
import { tileLabels } from "./labels.ts";
import { MIN_TILE, PER_SHEET } from "./layout.ts";
import { anyTileTooSmall, composeSheet, type LabelState, type Sheet, type SheetItem } from "./render.ts";

export type ContentBlock =
	| { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" }
	| { type: "text"; text: string };

/**
 * Returns one image block per sheet, then one text block that maps every position to its file.
 * The text block exists because labels can be cut or missing; the position list is always complete.
 */
export async function readImages(
	inputs: readonly string[],
	{ fontFamily = findCjkFamily() }: { fontFamily?: string | null } = {},
): Promise<ContentBlock[]> {
	const paths = expandInputs(inputs);
	const labels = tileLabels(paths);

	const sheets: Sheet[] = [];
	const sheetLines: string[] = [];
	let anyUnlabelled = false;
	let tooSmall = false;

	for (let start = 0; start < paths.length; start += PER_SHEET) {
		const chunk = paths.slice(start, start + PER_SHEET);
		// Decoded images are held for one sheet at a time, so memory stays bounded by PER_SHEET.
		const items: SheetItem[] = await Promise.all(
			chunk.map(async (path, i) => ({ label: labelAt(labels, start + i), image: await decode(path) })),
		);
		const sheet = composeSheet(items, fontFamily);
		sheets.push(sheet);
		tooSmall ||= anyTileTooSmall(sheet.tiles);

		const number = sheets.length;
		const first = start + 1;
		const last = start + chunk.length;
		sheetLines.push(`Sheet ${number} (positions ${first}-${last}):`);
		for (const tile of [...sheet.tiles].sort((a, b) => a.index - b.index)) {
			const position = start + tile.index + 1;
			anyUnlabelled ||= tile.label === "not-drawn";
			sheetLines.push(`  ${position}. ${paths[start + tile.index]}${annotate(tile.label)}`);
		}
	}

	const header = `${paths.length} image(s) on ${sheets.length} sheet(s), in input order (left to right, top to bottom).`;
	const notes: string[] = [];
	if (anyUnlabelled && fontFamily === null) {
		notes.push("No Japanese-capable font is installed, so labels with non-ASCII characters are left off the sheets.");
	}
	if (tooSmall) {
		notes.push(
			`Some tiles are under ${MIN_TILE} px; the images may be hard to read. Open the full-size file for fine detail.`,
		);
	}
	const text = [header, ...notes, ...sheetLines].join("\n");

	return [
		...sheets.map((sheet): ContentBlock => ({ type: "image", data: sheet.data, mimeType: sheet.mimeType })),
		{ type: "text", text },
	];
}

function annotate(label: LabelState): string {
	if (label === "cut") return " (label cut off)";
	if (label === "not-drawn") return " (label not drawn)";
	return "";
}

function labelAt(labels: readonly string[], i: number): string {
	const label = labels[i];
	if (label === undefined) throw new RangeError(`no label for position ${i}`);
	return label;
}

/** Any decode failure fails the whole call, so no sheet can show a label for the wrong image. */
async function decode(path: string): Promise<Image> {
	try {
		return await loadImage(readFileSync(path));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`cannot read ${path}: ${reason}`);
	}
}
