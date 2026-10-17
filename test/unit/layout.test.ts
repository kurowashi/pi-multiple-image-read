/**
 * Unit: sheet layout. Pure arithmetic, so every rule is checked on numbers alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	fits,
	MAX_EDGE,
	MAX_PATCHES,
	MIN_TILE,
	metrics,
	PATCH,
	PER_SHEET,
	planLayout,
	type Tile,
} from "../../src/layout.ts";

/** Element at `i`; fails the test instead of returning undefined. */
function at<T>(xs: readonly T[], i: number): T {
	const x = xs[i];
	assert.ok(x !== undefined, `index ${i} is out of range`);
	return x;
}

function overlaps(a: Tile, b: Tile): boolean {
	return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Image area ratio between the largest and the smallest tile. */
function areaRatio(tiles: readonly Tile[]): number {
	const areas = tiles.map((t) => (t.x1 - t.x0) * (t.y1 - t.y0));
	return Math.max(...areas) / Math.min(...areas);
}

/** Aspect ratios (width / height) of the seven reference images in the sample set. */
const REFERENCE_ASPECTS = [1.5, 1.5, 0.565, 0.433, 0.75, 0.563, 0.684];

test("fits enforces both the long-edge cap and the patch cap", () => {
	const longest = Math.floor(MAX_EDGE / PATCH) * PATCH;
	assert.ok(fits(longest, longest / 2), "a sheet at the largest patch-aligned long edge fits");
	assert.ok(!fits(MAX_EDGE + PATCH, 100), "a sheet past the long-edge cap does not fit");
	const side = Math.floor(Math.sqrt(MAX_PATCHES)) * PATCH;
	assert.ok(fits(side, side), "a square at the patch cap fits");
	assert.ok(!fits(side + PATCH, side + PATCH), "a square past the patch cap does not fit");
});

test("the long edge stays within pi's default resize cap, so pi never downscales a sheet", () => {
	assert.ok(MAX_EDGE <= 2000, `MAX_EDGE is ${MAX_EDGE}; pi's default resize cap is 2000 px`);
});

test("a full sheet keeps every tile at least MIN_TILE on each side", () => {
	const aspects = Array.from({ length: PER_SHEET }, () => 1280 / 800);
	const layout = planLayout(
		aspects,
		aspects.map(() => 800),
	);
	assert.ok(layout);
	for (const t of layout.tiles) {
		assert.ok(t.x1 - t.x0 >= MIN_TILE, `tile width ${t.x1 - t.x0} is below ${MIN_TILE}`);
		assert.ok(t.y1 - t.y0 >= MIN_TILE, `tile height ${t.y1 - t.y0} is below ${MIN_TILE}`);
	}
});

test("a sheet never exceeds the budget, for varied aspect ratios", () => {
	const cases: Array<{ aspects: number[]; heights: number[] }> = [
		{ aspects: [1], heights: [1000] },
		{ aspects: [16 / 9, 9 / 16, 1, 3, 1 / 3], heights: [900, 1600, 1000, 300, 900] },
		{ aspects: Array.from({ length: 12 }, (_, i) => 0.5 + i * 0.2), heights: Array.from({ length: 12 }, () => 1000) },
	];
	for (const { aspects, heights } of cases) {
		const layout = planLayout(aspects, heights);
		assert.ok(layout, "a layout must exist");
		assert.ok(fits(layout.width, layout.height), `${layout.width}x${layout.height} must fit the budget`);
	}
});

test("every tile and its label band lie inside the sheet, and no two tiles overlap", () => {
	const aspects = [1.5, 0.66, 2, 1, 0.5, 1.78];
	const layout = planLayout(aspects, [800, 1200, 500, 900, 1000, 600]);
	assert.ok(layout);
	const tiles = layout.tiles;
	for (const t of tiles) {
		assert.ok(
			t.x0 >= 0 && t.y0 >= 0 && t.x1 <= layout.width && t.y1 + t.band <= layout.height,
			"tile and band must lie inside the sheet",
		);
		assert.ok(t.band > 0, "every tile has a label band");
	}
	for (let i = 0; i < tiles.length; i++) {
		for (let j = i + 1; j < tiles.length; j++) {
			assert.ok(!overlaps(at(tiles, i), at(tiles, j)), `tiles ${i} and ${j} must not overlap`);
		}
	}
});

test("the sheet fills its budget: no tile row leaves a band of empty space at the bottom", () => {
	const layout = planLayout([1, 1], [1000, 1000]);
	assert.ok(layout);
	const lowest = Math.max(...layout.tiles.map((t) => t.y1 + t.band));
	assert.ok(layout.height - lowest <= 1, `${layout.height - lowest} px of the sheet is unused below the tiles`);
});

test("every input index is placed exactly once", () => {
	const aspects = [1, 2, 0.5, 1.2, 0.8];
	const layout = planLayout(aspects, [500, 500, 500, 500, 500]);
	assert.ok(layout);
	assert.deepEqual(
		layout.tiles.map((t) => t.index).sort((a, b) => a - b),
		[0, 1, 2, 3, 4],
	);
});

test("a tile is never taller than its source image", () => {
	// A tiny image next to a huge one must not be stretched to match the huge one's size.
	const layout = planLayout([1, 1], [40, 4000]);
	assert.ok(layout);
	for (const tile of layout.tiles) {
		const sourceHeights = [40, 4000];
		assert.ok(tile.y1 - tile.y0 <= at(sourceHeights, tile.index), `tile ${tile.index} exceeds its source height`);
	}
});

test("each tile keeps its aspect ratio, to the pixel", () => {
	const aspects = [1.5, 0.5, 0.75, 1.78];
	const layout = planLayout(aspects, [900, 900, 900, 900]);
	assert.ok(layout);
	for (const tile of layout.tiles) {
		const w = tile.x1 - tile.x0;
		const h = tile.y1 - tile.y0;
		const want = at(aspects, tile.index);
		assert.ok(Math.abs(w / h - want) / want < 0.02, `tile ${tile.index} is ${w}x${h}, want aspect ${want}`);
	}
});

test("tile areas are close to equal for the reference aspect ratios", () => {
	const layout = planLayout(
		REFERENCE_ASPECTS,
		REFERENCE_ASPECTS.map(() => 1000),
	);
	assert.ok(layout);
	// The first row-based layout gave 3.6; the slice layout measured 1.4 to 2.0 across seeds.
	assert.ok(areaRatio(layout.tiles) <= 2.1, `area ratio ${areaRatio(layout.tiles).toFixed(2)} is above 2.1`);
});

test("the same input gives the same layout every time", () => {
	const first = planLayout(
		REFERENCE_ASPECTS,
		REFERENCE_ASPECTS.map(() => 1000),
	);
	const second = planLayout(
		REFERENCE_ASPECTS,
		REFERENCE_ASPECTS.map(() => 1000),
	);
	assert.deepEqual(first, second);
});

test("label font scales with the sheet width, and never drops below the minimum", () => {
	const small = metrics(200);
	const large = metrics(1500);
	assert.ok(large.labelPx > small.labelPx);
	assert.equal(small.labelPx, 16, "the minimum label font applies at small widths");
});

test("a wider tile gets a taller label band", () => {
	const layout = planLayout([3, 0.4], [600, 600]);
	assert.ok(layout);
	const wide = layout.tiles.find((t) => t.index === 0);
	const tall = layout.tiles.find((t) => t.index === 1);
	assert.ok(wide && tall);
	assert.ok(wide.band > tall.band, `band ${wide.band} should exceed ${tall.band}`);
});

test("an empty input has no layout", () => {
	assert.equal(planLayout([], []), null);
});
