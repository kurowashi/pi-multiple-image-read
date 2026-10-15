/**
 * Draws one contact sheet from decoded images, then encodes it under the inline size limit.
 */

import { type Canvas, createCanvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { labelFont } from "./font.ts";
import { canDrawLabel, fitLabel } from "./labels.ts";
import { type Layout, MIN_TILE, planLayout } from "./layout.ts";

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

export interface SheetItem {
	/** Label to draw, before fitting. */
	label: string;
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

/** Draw the items as one sheet, in input order from left to right and top to bottom. */
export function composeSheet(items: readonly SheetItem[], fontFamily: string | null): Sheet {
	const layout = planLayout(
		items.map((item) => item.image.width / item.image.height),
		items.map((item) => item.image.height),
	);
	if (layout === null) throw new Error("no layout fits the image budget");

	const canvas = createCanvas(layout.width, layout.height);
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingQuality = "high";
	ctx.fillStyle = GAP_RGB;
	ctx.fillRect(0, 0, layout.width, layout.height);

	const tiles = layout.tiles.map((tile): TileReport => {
		const item = items[tile.index];
		if (!item) throw new Error(`layout refers to missing item ${tile.index}`);
		const width = tile.x1 - tile.x0;
		const height = tile.y1 - tile.y0;
		ctx.drawImage(item.image, tile.x0, tile.y0, width, height);
		ctx.fillStyle = BAND_RGB;
		ctx.fillRect(tile.x0, tile.y1, width, layout.band);
		return { index: tile.index, label: drawLabel(ctx, item.label, layout, tile, fontFamily), width, height };
	});

	return { ...encode(canvas), tiles };
}

function drawLabel(
	ctx: SKRSContext2D,
	text: string,
	layout: Layout,
	tile: Layout["tiles"][number],
	fontFamily: string | null,
): LabelState {
	if (!canDrawLabel(text, fontFamily !== null)) return "not-drawn";
	const maxWidth = tile.x1 - tile.x0 - LABEL_PAD;
	const fitted = fitLabel(text, maxWidth, layout.labelPx, (candidate, px) => {
		ctx.font = labelFont(px, fontFamily);
		return ctx.measureText(candidate).width;
	});
	if (fitted === null) return "not-drawn";
	ctx.font = labelFont(fitted.px, fontFamily);
	ctx.fillStyle = TEXT_RGB;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(fitted.text, (tile.x0 + tile.x1) / 2, tile.y1 + layout.band / 2);
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
