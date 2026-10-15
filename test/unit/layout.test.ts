/**
 * Unit: sheet layout. Pure arithmetic, so every rule is checked on numbers alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { balancedRows, fits, MAX_EDGE, MAX_PATCHES, metrics, PATCH, planLayout, type Tile } from "../../src/layout.ts";

/** Element at `i`; fails the test instead of returning undefined. */
function at<T>(xs: readonly T[], i: number): T {
	const x = xs[i];
	assert.ok(x !== undefined, `index ${i} is out of range`);
	return x;
}

function overlaps(a: Tile, b: Tile): boolean {
	return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

test("balancedRows keeps groups contiguous and covers every index once", () => {
	const groups = balancedRows([1, 2, 3, 4, 5, 6], 3);
	assert.deepEqual(groups.flat(), [0, 1, 2, 3, 4, 5]);
	assert.equal(groups.length, 3);
});

test("balancedRows minimises the largest row sum", () => {
	// Ideal split of [4,4,1,1,4,4] into 2 rows is [4,4,1] [1,4,4] with sums 9 and 9.
	const groups = balancedRows([4, 4, 1, 1, 4, 4], 2);
	const weights = [4, 4, 1, 1, 4, 4];
	const sums = groups.map((g) => g.reduce((s, i) => s + at(weights, i), 0));
	assert.ok(Math.max(...sums) <= 9, `largest row sum was ${Math.max(...sums)}`);
});

test("fits enforces both the long-edge cap and the patch cap", () => {
	assert.ok(fits(MAX_EDGE, MAX_EDGE / 2), "a sheet at the long-edge cap fits");
	assert.ok(!fits(MAX_EDGE + PATCH, 100), "a sheet past the long-edge cap does not fit");
	const side = Math.floor(Math.sqrt(MAX_PATCHES)) * PATCH;
	assert.ok(fits(side, side), "a square at the patch cap fits");
	assert.ok(!fits(side + PATCH, side + PATCH), "a square past the patch cap does not fit");
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

test("every tile lies inside the sheet and no two tiles overlap", () => {
	const aspects = [1.5, 0.66, 2, 1, 0.5, 1.78];
	const layout = planLayout(aspects, [800, 1200, 500, 900, 1000, 600]);
	assert.ok(layout);
	const tiles = layout.tiles;
	for (const t of tiles) {
		assert.ok(
			t.x0 >= 0 && t.y0 >= 0 && t.x1 <= layout.width && t.y1 <= layout.height,
			"tile must lie inside the sheet",
		);
	}
	for (let i = 0; i < tiles.length; i++) {
		for (let j = i + 1; j < tiles.length; j++) {
			assert.ok(!overlaps(at(tiles, i), at(tiles, j)), `tiles ${i} and ${j} must not overlap`);
		}
	}
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
	// A tiny image next to a huge one must not be stretched to match the huge one's row height.
	const layout = planLayout([1, 1], [40, 4000]);
	assert.ok(layout);
	for (const tile of layout.tiles) {
		const sourceHeights = [40, 4000];
		assert.ok(tile.y1 - tile.y0 <= at(sourceHeights, tile.index), `tile ${tile.index} exceeds its source height`);
	}
});

test("label band and font scale with the sheet width, and the font never drops below the minimum", () => {
	const small = metrics(200);
	const large = metrics(1500);
	assert.ok(large.labelPx > small.labelPx);
	assert.equal(small.labelPx, 16, "the minimum label font applies at small widths");
	assert.ok(large.band > small.band);
});

test("an empty input has no layout", () => {
	assert.equal(planLayout([], []), null);
});
