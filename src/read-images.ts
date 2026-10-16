/**
 * The tool's work: resolve the inputs, decode images in input order, pack them into sheets, and describe the result.
 */

import { readFileSync } from "node:fs";
import { type Image, loadImage } from "@napi-rs/canvas";
import { expandInputs } from "./files.ts";
import { findCjkFamily } from "./font.ts";
import { tileLabels } from "./labels.ts";
import { MIN_TILE, PER_SHEET } from "./layout.ts";
import {
	anyTileTooSmall,
	composeSheet,
	type LabelState,
	type Sheet,
	type SheetItem,
	type TileReport,
} from "./render.ts";

export type ContentBlock =
	| { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" }
	| { type: "text"; text: string };

/**
 * Returns one image block per sheet, then a text block only when some image needs a name the label cannot give:
 * the label was cut off or not drawn, or it is shared with another file. Every other image is identified by its label.
 */
export async function readImages(
	inputs: readonly string[],
	{ fontFamily = findCjkFamily() }: { fontFamily?: string | null } = {},
): Promise<ContentBlock[]> {
	const paths = expandInputs(inputs);
	const labels = tileLabels(paths);
	const labelCount = new Map<string, number>();
	for (const label of labels) labelCount.set(label, (labelCount.get(label) ?? 0) + 1);

	const sheets: Sheet[] = [];
	const reports: TileReport[] = [];
	for (let start = 0; start < paths.length; start += PER_SHEET) {
		const chunk = paths.slice(start, start + PER_SHEET);
		// Decoded images are held for one sheet at a time, so memory stays bounded by PER_SHEET.
		const items: SheetItem[] = await Promise.all(
			chunk.map(async (path, i) => ({ label: labelAt(labels, start + i), image: await decode(path) })),
		);
		const sheet = composeSheet(items, fontFamily);
		sheets.push(sheet);
		for (const tile of [...sheet.tiles].sort((x, y) => x.index - y.index)) {
			reports.push({ ...tile, index: start + tile.index });
		}
	}

	const blocks: ContentBlock[] = sheets.map((sheet) => ({ type: "image", data: sheet.data, mimeType: sheet.mimeType }));
	const text = describe(paths, sheets.length, reports, labelCount, labels, fontFamily);
	if (text.length > 0) blocks.push({ type: "text", text });
	return blocks;
}

/** The text block: notes, and a line for each image whose label cannot identify it. Empty when neither applies. */
function describe(
	paths: readonly string[],
	sheetCount: number,
	reports: readonly TileReport[],
	labelCount: ReadonlyMap<string, number>,
	labels: readonly string[],
	fontFamily: string | null,
): string {
	const notes: string[] = [];
	if (fontFamily === null && reports.some((tile) => tile.label === "not-drawn")) {
		notes.push("No Japanese-capable font is installed, so labels with non-ASCII characters are left off the sheets.");
	}
	if (anyTileTooSmall(reports)) {
		notes.push(
			`Some tiles are under ${MIN_TILE} px; the images may be hard to read. Open the full-size file for fine detail.`,
		);
	}
	const listed = reports.flatMap((tile) => {
		const shared = (labelCount.get(labelAt(labels, tile.index)) ?? 0) > 1;
		if (tile.label === "drawn" && !shared) return [];
		return [`  ${tile.index + 1}. ${paths[tile.index]}${annotate(tile.label, shared)}`];
	});
	const parts =
		listed.length > 0
			? [
					`${paths.length} image(s) on ${sheetCount} sheet(s); positions run in input order, left to right, top to bottom. Listed: labels cut off, not drawn, or shared.`,
					...listed,
				]
			: [];
	return [...notes, ...parts].join("\n");
}

function annotate(label: LabelState, shared: boolean): string {
	if (label === "cut") return " (label cut off)";
	if (label === "not-drawn") return " (label not drawn)";
	return shared ? " (label shared with another file)" : "";
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
