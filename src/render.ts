/**
 * Draws one contact sheet from decoded images, then encodes it under the inline size limit.
 */

import { type Canvas, createCanvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { labelFont } from "./font.ts";
import { canDrawLabel, fitLabel } from "./labels.ts";
import { type Layout, MIN_FONT, MIN_TILE, planLayout, type Tile } from "./layout.ts";

/** Pi's inline image limit, in base64 bytes. Above it a PNG is re-encoded as JPEG. */
export const INLINE_B64_MAX = 4.5 * 1024 * 1024;
/** JPEG qualities to try, highest first. Noise-like sheets can exceed the limit even at 92. */
const JPEG_QUALITIES = [92, 85, 75, 65, 50] as const;

/** Background behind transparent pixels and gaps. */
const GAP_RGB = "rgb(128,128,128)";
const BAND_RGB = "rgb(20,20,20)";
const TEXT_RGB = "rgb(240,240,240)";
/** Horizontal padding inside a label band. */
const LABEL_PAD = 8;
/** Line height as a multiple of the font size. A label fits its band when its font is no taller than band / this. */
const LABEL_LINE = 1.2;

export interface SheetItem {
	/** The image's position in the input, drawn in front of the name so the reply can refer to it. */
	number: number;
	/** File name without extension, or with it when two files share a stem. */
	name: string;
	image: Image;
}

/** What happened to one tile's label, so the reply can say so. */
export type LabelState = "drawn" | "cut" | "not-drawn";

export interface TileReport {
	/** Index into the sheet's items. */
	index: number;
	label: LabelState;
	/** Tile size on the sheet in px. */
	width: number;
	height: number;
}

export interface Sheet {
	mimeType: "image/png" | "image/jpeg";
	/** Base64 of the encoded sheet, ready for an image content block. */
	data: string;
	tiles: TileReport[];
}

export function b64Length(bytes: number): number {
	return 4 * Math.ceil(bytes / 3);
}

/** Draw the items as one sheet. Where each image goes is the layout's choice, not the input order's. */
export function composeSheet(items: readonly SheetItem[], fontFamily: string | null): Sheet {
	const layout = planLayout(
		items.map((item) => item.image.width / item.image.height),
		items.map((item) => item.image.height),
	);
	if (layout === null) throw new Error("no layout fits the image budget");

	const canvas = createCanvas(layout.width, layout.height);
	const ctx = canvas.getContext("2d");
	// Measured: "high" blurred thin strokes of small labels and the model misread them; "medium" did not (ADR 0005).
	ctx.imageSmoothingQuality = "medium";
	ctx.fillStyle = GAP_RGB;
	ctx.fillRect(0, 0, layout.width, layout.height);

	const tiles = layout.tiles.map((tile): TileReport => {
		const item = items[tile.index];
		if (!item) throw new Error(`layout refers to missing item ${tile.index}`);
		const width = tile.x1 - tile.x0;
		const height = tile.y1 - tile.y0;
		ctx.drawImage(item.image, tile.x0, tile.y0, width, height);
		ctx.fillStyle = BAND_RGB;
		ctx.fillRect(tile.x0, tile.y1, width, tile.band);
		return { index: tile.index, label: drawLabel(ctx, item, layout, tile, fontFamily), width, height };
	});

	return { ...encode(canvas), tiles };
}

/**
 * Draws the number and the name. A name that the font cannot draw leaves only the number, and the tile says so.
 */
function drawLabel(
	ctx: SKRSContext2D,
	item: SheetItem,
	layout: Layout,
	tile: Tile,
	fontFamily: string | null,
): LabelState {
	const drawable = canDrawLabel(item.name, fontFamily !== null);
	const text = drawable ? `${item.number} ${item.name}` : String(item.number);
	const maxWidth = tile.x1 - tile.x0 - LABEL_PAD;
	const startPx = Math.min(layout.labelPx, Math.max(MIN_FONT, Math.floor(tile.band / LABEL_LINE)));
	const fitted = fitLabel(text, maxWidth, startPx, (candidate, px) => {
		ctx.font = labelFont(px, fontFamily);
		return ctx.measureText(candidate).width;
	});
	if (fitted === null) return "not-drawn";
	ctx.font = labelFont(fitted.px, fontFamily);
	ctx.fillStyle = TEXT_RGB;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(fitted.text, (tile.x0 + tile.x1) / 2, tile.y1 + tile.band / 2);
	if (!drawable) return "not-drawn";
	return fitted.truncated ? "cut" : "drawn";
}

/** PNG if it fits the inline limit, else the best JPEG that fits. */
export function encode(canvas: Canvas): Pick<Sheet, "mimeType" | "data"> {
	const png = canvas.toBuffer("image/png");
	if (b64Length(png.length) <= INLINE_B64_MAX) return { mimeType: "image/png", data: png.toString("base64") };
	// Falls through to the lowest quality when none fits; that sheet is then still sent, and pi may resize it.
	let jpeg = canvas.toBuffer("image/jpeg", JPEG_QUALITIES[0]);
	for (const quality of JPEG_QUALITIES.slice(1)) {
		if (b64Length(jpeg.length) <= INLINE_B64_MAX) break;
		jpeg = canvas.toBuffer("image/jpeg", quality);
	}
	return { mimeType: "image/jpeg", data: jpeg.toString("base64") };
}

/** Whether any tile on the sheets is too small to read detail from. */
export function anyTileTooSmall(tiles: readonly TileReport[]): boolean {
	return tiles.some((tile) => Math.min(tile.width, tile.height) < MIN_TILE);
}
