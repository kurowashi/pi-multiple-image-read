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

/** Images per call. A call returns at most this many; `offset` reads the next page. */
const PAGE_SIZE = 48;

/** A position on the sheets, the file behind it, and how its label fared. */
interface Placed {
	position: number;
	path: string;
	label: LabelState;
	shared: boolean;
}

/**
 * Returns one image block per sheet, then a text block only when something needs a line: a label that cannot
 * identify its image, a file that was skipped or unreadable, or more images than this page holds.
 */
export async function readImages(
	inputs: readonly string[],
	{ offset = 0, fontFamily = findCjkFamily() }: { offset?: number; fontFamily?: string | null } = {},
): Promise<ContentBlock[]> {
	const expanded = expandInputs(inputs);
	const total = expanded.paths.length;
	if (offset >= total) throw new Error(`offset ${offset} is past the last image (${total} found)`);
	const end = Math.min(offset + PAGE_SIZE, total);
	// Labels come from every input, so a page's labels do not depend on which page it is.
	const labels = tileLabels(expanded.paths);
	const page = await composePage(expanded.paths.slice(offset, end), offset, labels, fontFamily);

	const range = pageRange(offset, end, total);
	if (page.sheets.length === 0 && range === "") {
		throw new Error(`no readable images: ${page.unreadable.map((u) => `${u.path} (${u.reason})`).join("; ")}`);
	}

	const blocks: ContentBlock[] = page.sheets.map((sheet) => ({
		type: "image",
		data: sheet.data,
		mimeType: sheet.mimeType,
	}));
	const text = describe({
		placed: page.placed,
		skipped: expanded.skipped,
		unreadable: page.unreadable,
		sheetCount: page.sheets.length,
		tiles: page.sheets.flatMap((sheet) => sheet.tiles),
		fontFamily,
		range,
	});
	if (text.length > 0) blocks.push({ type: "text", text });
	return blocks;
}

interface Page {
	sheets: Sheet[];
	placed: Placed[];
	unreadable: Skipped[];
}

/** Decodes and packs one page, a sheet at a time. Positions are input positions across all pages. */
async function composePage(
	paths: readonly string[],
	offset: number,
	labels: readonly string[],
	fontFamily: string | null,
): Promise<Page> {
	const labelCount = countLabels(labels);
	const page: Page = { sheets: [], placed: [], unreadable: [] };
	for (let start = 0; start < paths.length; start += PER_SHEET) {
		const chunk = paths.slice(start, start + PER_SHEET);
		// Decoded images are held for one sheet at a time, so memory stays bounded by PER_SHEET.
		const decoded = await Promise.all(chunk.map((path) => decodeOrReason(path)));
		const items: SheetItem[] = [];
		const members: number[] = [];
		decoded.forEach((result, i) => {
			const index = offset + start + i;
			if (result.ok) {
				items.push({ label: labelAt(labels, index), image: result.image });
				members.push(index);
			} else {
				page.unreadable.push({ path: chunk[i] ?? "", reason: result.reason });
			}
		});
		if (items.length === 0) continue;

		const sheet = composeSheet(items, fontFamily);
		page.sheets.push(sheet);
		// Positions follow the reading order on the sheet, which is the order of the items.
		for (const tile of [...sheet.tiles].sort((x, y) => x.index - y.index)) {
			const index = members[tile.index];
			if (index === undefined) throw new RangeError(`no member for tile ${tile.index}`);
			page.placed.push({
				position: offset + page.placed.length + 1,
				path: labelPath(paths, offset, index),
				label: tile.label,
				shared: (labelCount.get(labelAt(labels, index)) ?? 0) > 1,
			});
		}
	}
	return page;
}

function labelPath(paths: readonly string[], offset: number, index: number): string {
	const path = paths[index - offset];
	if (path === undefined) throw new RangeError(`no path for position ${index}`);
	return path;
}

interface Description {
	placed: readonly Placed[];
	skipped: readonly Skipped[];
	unreadable: readonly Skipped[];
	sheetCount: number;
	tiles: readonly TileReport[];
	fontFamily: string | null;
	/** Which images this page covers, and the offset for the next page. Empty when everything fits in one call. */
	range: string;
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

	if (listed.length === 0 && d.range === "") return notes.join("\n");
	const summary = `${d.placed.length} image(s) on ${d.sheetCount} sheet(s); positions run in input order, left to right, top to bottom.`;
	return [...notes, ...(d.range === "" ? [] : [d.range]), summary, ...listed].join("\n");
}

/**
 * Empty when the call covers every image from the start. Otherwise, the input span this call covers and the next
 * offset, if any. The span counts inputs, so it can exceed the number of images returned when some files were skipped.
 */
function pageRange(offset: number, end: number, total: number): string {
	if (offset === 0 && end === total) return "";
	const shown = `Showing inputs ${offset + 1}-${end} of ${total}.`;
	return end < total ? `${shown} For the rest, call again with offset ${end}.` : shown;
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
