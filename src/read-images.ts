/**
 * The tool's work: resolve the inputs, decode images in input order, pack them into sheets, and describe the result.
 */

import { readFileSync } from "node:fs";
import { type Image, loadImage } from "@napi-rs/canvas";
import { expandInputs, type Skipped } from "./files.ts";
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

/** A position on the sheets, the file behind it, and how its label fared. */
interface Placed {
	position: number;
	path: string;
	label: LabelState;
	shared: boolean;
}

/**
 * Returns one image block per sheet, then a text block only when something needs a line: a label that cannot
 * identify its image, a file that was skipped, or a file that could not be read. Other images are identified by label.
 */
export async function readImages(
	inputs: readonly string[],
	{ fontFamily = findCjkFamily() }: { fontFamily?: string | null } = {},
): Promise<ContentBlock[]> {
	const expanded = expandInputs(inputs);
	const candidates = expanded.paths;
	// Labels come from every candidate, so a file that later fails to decode does not change another file's label.
	const labels = tileLabels(candidates);
	const labelCount = countLabels(labels);

	const sheets: Sheet[] = [];
	const placed: Placed[] = [];
	const unreadable: Skipped[] = [];

	for (let start = 0; start < candidates.length; start += PER_SHEET) {
		const chunk = candidates.slice(start, start + PER_SHEET);
		// Decoded images are held for one sheet at a time, so memory stays bounded by PER_SHEET.
		const decoded = await Promise.all(chunk.map((path) => decodeOrReason(path)));
		const items: SheetItem[] = [];
		const members: number[] = [];
		decoded.forEach((result, i) => {
			const index = start + i;
			if (result.ok) {
				items.push({ label: labelAt(labels, index), image: result.image });
				members.push(index);
			} else {
				unreadable.push({ path: chunk[i] ?? "", reason: result.reason });
			}
		});
		if (items.length === 0) continue;

		const sheet = composeSheet(items, fontFamily);
		sheets.push(sheet);
		// Positions follow the reading order on the sheet, which is the order of the items.
		for (const tile of [...sheet.tiles].sort((x, y) => x.index - y.index)) {
			const index = members[tile.index];
			if (index === undefined) throw new RangeError(`no member for tile ${tile.index}`);
			placed.push({
				position: placed.length + 1,
				path: candidates[index] ?? "",
				label: tile.label,
				shared: (labelCount.get(labelAt(labels, index)) ?? 0) > 1,
			});
		}
	}

	if (sheets.length === 0) {
		throw new Error(`no readable images: ${unreadable.map((u) => `${u.path} (${u.reason})`).join("; ")}`);
	}

	const blocks: ContentBlock[] = sheets.map((sheet) => ({ type: "image", data: sheet.data, mimeType: sheet.mimeType }));
	const text = describe({
		placed,
		skipped: expanded.skipped,
		unreadable,
		sheetCount: sheets.length,
		tiles: sheets.flatMap((sheet) => sheet.tiles),
		fontFamily,
	});
	if (text.length > 0) blocks.push({ type: "text", text });
	return blocks;
}

interface Description {
	placed: readonly Placed[];
	skipped: readonly Skipped[];
	unreadable: readonly Skipped[];
	sheetCount: number;
	tiles: readonly TileReport[];
	fontFamily: string | null;
}

/** The text block: notes, and a line for each image whose name the label cannot give. Empty when none applies. */
function describe(d: Description): string {
	const notes: string[] = [];
	if (d.fontFamily === null && d.tiles.some((tile) => tile.label === "not-drawn")) {
		notes.push("No Japanese-capable font is installed, so labels with non-ASCII characters are left off the sheets.");
	}
	if (anyTileTooSmall(d.tiles)) {
		notes.push(
			`Some tiles are under ${MIN_TILE} px; the images may be hard to read. Open the full-size file for fine detail.`,
		);
	}
	const listed = d.placed
		.filter((p) => p.label !== "drawn" || p.shared)
		.map((p) => `  ${p.position}. ${p.path}${annotate(p.label, p.shared)}`);
	for (const skip of d.skipped) listed.push(`  skipped: ${skip.path} (${skip.reason})`);
	for (const bad of d.unreadable) listed.push(`  skipped: ${bad.path} (${bad.reason})`);

	if (listed.length === 0) return notes.join("\n");
	const summary = `${d.placed.length} image(s) on ${d.sheetCount} sheet(s); positions run in input order, left to right, top to bottom.`;
	return [...notes, summary, ...listed].join("\n");
}

function countLabels(labels: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
	return counts;
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

type Decoded = { ok: true; image: Image } | { ok: false; reason: string };

/** A file that cannot be decoded is reported and left off the sheets; the rest of the call goes ahead. */
async function decodeOrReason(path: string): Promise<Decoded> {
	try {
		return { ok: true, image: await loadImage(readFileSync(path)) };
	} catch (error) {
		return { ok: false, reason: `cannot decode: ${error instanceof Error ? error.message : String(error)}` };
	}
}
