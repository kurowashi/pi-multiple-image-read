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

/** An image on the sheets: its number, the file behind it, and how its label fared. */
interface Placed {
	number: number;
	path: string;
	label: LabelState;
	shared: boolean;
}

/**
 * Returns one image block per sheet, then one text block that maps each number to its path. The text is always
 * there, because a label can be cut off, and because the sheet does not show the input order.
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
	const names = tileLabels(expanded.paths);
	const page = await composePage(expanded.paths.slice(offset, end), offset, names, fontFamily);

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

/** Decodes and packs one page, a sheet at a time. Numbers are input positions across all pages. */
async function composePage(
	paths: readonly string[],
	offset: number,
	names: readonly string[],
	fontFamily: string | null,
): Promise<Page> {
	const nameCount = countNames(names);
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
				items.push({ number: index + 1, name: nameAt(names, index), image: result.image });
				members.push(index);
			} else {
				page.unreadable.push({ path: chunk[i] ?? "", reason: result.reason });
			}
		});
		if (items.length === 0) continue;

		const sheet = composeSheet(items, fontFamily);
		page.sheets.push(sheet);
		for (const tile of sheet.tiles) {
			const index = members[tile.index];
			if (index === undefined) throw new RangeError(`no member for tile ${tile.index}`);
			page.placed.push({
				number: index + 1,
				path: pathAt(paths, index - offset),
				label: tile.label,
				shared: (nameCount.get(nameAt(names, index)) ?? 0) > 1,
			});
		}
	}
	page.placed.sort((x, y) => x.number - y.number);
	return page;
}

function pathAt(paths: readonly string[], i: number): string {
	const path = paths[i];
	if (path === undefined) throw new RangeError(`no path at ${i}`);
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

/**
 * The text block: notes, then every image as `number. path`. The number is drawn before the name on each label.
 * A label that was cut, not drawn, or shared is marked on its line.
 */
function describe(d: Description): string {
	const notes: string[] = [];
	if (d.fontFamily === null && d.tiles.some((tile) => tile.label === "not-drawn")) {
		notes.push("No Japanese-capable font is installed, so names with non-ASCII characters are left off the labels.");
	}
	if (anyTileTooSmall(d.tiles)) {
		notes.push(
			`Some tiles are under ${MIN_TILE} px; the images may be hard to read. Open the full-size file for fine detail.`,
		);
	}
	const listed = d.placed.map((p) => `  ${p.number}. ${p.path}${annotate(p.label, p.shared)}`);
	for (const skip of d.skipped) listed.push(`  skipped: ${skip.path} (${skip.reason})`);
	for (const bad of d.unreadable) listed.push(`  skipped: ${bad.path} (${bad.reason})`);

	if (listed.length === 0 && d.range === "") return notes.join("\n");
	const summary = `${d.placed.length} image(s) on ${d.sheetCount} sheet(s). Each label shows its number, then the file name.`;
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

function countNames(names: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	return counts;
}

function annotate(label: LabelState, shared: boolean): string {
	if (label === "cut") return " (label cut off)";
	if (label === "not-drawn") return " (label not drawn)";
	return shared ? " (label shared with another file)" : "";
}

function nameAt(names: readonly string[], i: number): string {
	const name = names[i];
	if (name === undefined) throw new RangeError(`no name for position ${i}`);
	return name;
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
