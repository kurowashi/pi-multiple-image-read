/**
 * Pure sheet layout: where each tile goes on a sheet, with no pixels and no I/O.
 *
 * A sheet is sized so that every tile is shown at full resolution within the image
 * cap. Pi downscales any image whose long edge exceeds 2000 px, which would thin the
 * labels, so a sheet never goes past that.
 */

/** Long edge of a sheet in px. pi resizes any longer image to 2000 px, so a sheet stays at or below it. */
export const MAX_EDGE = 2000;
/** Patches a sheet may span: each patch is PATCH x PATCH px and costs one visual token. */
export const MAX_PATCHES = 4784;
export const PATCH = 28;
/** Images per sheet. More images go to more sheets, not to smaller tiles. */
export const PER_SHEET = 24;
/** Smallest label font in px. Below this, labels are truncated rather than shrunk further. */
export const MIN_FONT = 16;
/** Tiles smaller than this (px, either side) make the reply warn that the images may be hard to read. */
export const MIN_TILE = 160;

/** Position and size of one tile. Pixel coordinates; x1 and y1 are exclusive. */
export interface Tile {
	/** Index into the aspect and height arrays given to planLayout. */
	index: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface Layout {
	width: number;
	height: number;
	gap: number;
	/** Label band height under each tile row. */
	band: number;
	/** Font size for labels on this sheet, before any shrinking to fit. */
	labelPx: number;
	tiles: Tile[];
}

/** Element at `i`. Throws instead of returning undefined, so an indexing bug cannot pass silently. */
function at<T>(xs: readonly T[], i: number): T {
	if (i < 0 || i >= xs.length) throw new RangeError(`index ${i} out of range (length ${xs.length})`);
	return xs[i] as T;
}

/** Split indexes 0..n-1 into k contiguous groups, minimising the largest aspect-ratio sum. */
export function balancedRows(aspects: readonly number[], k: number): number[][] {
	const n = aspects.length;
	const prefix: number[] = [0];
	for (const a of aspects) prefix.push(at(prefix, prefix.length - 1) + a);

	// best[j][i]: smallest possible largest-group sum splitting the first i items into j groups.
	const best = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => Number.POSITIVE_INFINITY));
	const cut = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => 0));
	at(best, 0)[0] = 0;
	for (let j = 1; j <= k; j++) {
		for (let i = j; i <= n; i++) {
			for (let p = j - 1; p < i; p++) {
				const v = Math.max(at(at(best, j - 1), p), at(prefix, i) - at(prefix, p));
				if (v < at(at(best, j), i)) {
					at(best, j)[i] = v;
					at(cut, j)[i] = p;
				}
			}
		}
	}

	const groups: number[][] = [];
	let end = n;
	for (let j = k; j > 0; j--) {
		const start = at(at(cut, j), end);
		groups.unshift(range(start, end));
		end = start;
	}
	return groups;
}

function range(from: number, to: number): number[] {
	return Array.from({ length: to - from }, (_, offset) => from + offset);
}

/** Whether a sheet of this size is within the budget. */
export function fits(width: number, height: number): boolean {
	const cols = Math.ceil(width / PATCH);
	const rows = Math.ceil(height / PATCH);
	return Math.max(cols, rows) * PATCH <= MAX_EDGE && cols * rows <= MAX_PATCHES;
}

/** Gap, label band, and label font for a sheet of width W. All scale with W. */
export function metrics(width: number): { gap: number; band: number; labelPx: number } {
	const labelPx = labelFontPx(width);
	return { gap: Math.max(6, Math.round(width * 0.008)), band: Math.round(labelPx * 1.6), labelPx };
}

function labelFontPx(width: number): number {
	return Math.max(MIN_FONT, Math.round(width * 0.016));
}

/** Tile rectangles for sheet width W with the given row groups. */
function geometry(
	width: number,
	aspects: readonly number[],
	groups: readonly (readonly number[])[],
	band: number,
	gap: number,
): { height: number; tiles: Tile[] } {
	const tiles: Tile[] = [];
	let y = gap;
	for (const group of groups) {
		const aspectSum = group.reduce((sum, i) => sum + at(aspects, i), 0);
		const rowHeight = (width - gap * (group.length + 1)) / aspectSum;
		let x = gap;
		for (const i of group) {
			const tileWidth = at(aspects, i) * rowHeight;
			tiles.push({
				index: i,
				x0: Math.round(x),
				y0: Math.round(y),
				x1: Math.round(x + tileWidth),
				y1: Math.round(y + rowHeight),
			});
			x += tileWidth + gap;
		}
		y += rowHeight + band + gap;
	}
	return { height: Math.round(y), tiles };
}

/**
 * Choose the row split and sheet width that show the most image pixels within the budget.
 *
 * A tile never grows taller than its source, so a small image is not upscaled to fill space.
 * Returns null when no layout fits, which happens only for an empty input.
 */
export function planLayout(aspects: readonly number[], heights: readonly number[]): Layout | null {
	let best: (Layout & { area: number }) | null = null;
	for (let k = 1; k <= aspects.length; k++) {
		const groups = balancedRows(aspects, k);
		const ok = (width: number): boolean => {
			const { gap, band } = metrics(width);
			const { height, tiles } = geometry(width, aspects, groups, band, gap);
			if (!fits(width, height)) return false;
			// Each row's tiles must not be taller than the shortest source image in that row.
			const rowSourceHeight = new Map<number, number>();
			for (const t of tiles) {
				const current = rowSourceHeight.get(t.y0) ?? Number.POSITIVE_INFINITY;
				rowSourceHeight.set(t.y0, Math.min(current, at(heights, t.index)));
			}
			return tiles.every((t) => t.y1 - t.y0 <= (rowSourceHeight.get(t.y0) ?? 0));
		};
		// Feasibility is monotone in width, so binary search finds the widest feasible sheet.
		if (!ok(1)) continue;
		let lo = 1;
		let hi = MAX_EDGE;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (ok(mid)) lo = mid;
			else hi = mid - 1;
		}
		const { gap, band, labelPx } = metrics(lo);
		const { height, tiles } = geometry(lo, aspects, groups, band, gap);
		const area = tiles.reduce((sum, t) => sum + (t.x1 - t.x0) * (t.y1 - t.y0), 0);
		if (best === null || area > best.area) {
			best = { width: lo, height, gap, band, labelPx, tiles, area };
		}
	}
	if (best === null) return null;
	const { area: _area, ...layout } = best;
	return layout;
}
