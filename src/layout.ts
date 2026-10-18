/**
 * Pure sheet layout: where each tile goes on a sheet, with no pixels and no I/O.
 *
 * Tiles are packed as a slice tree: every split cuts a rectangle into two side by side or one above the other.
 * The search chooses the tree so that the tiles' image areas come out close to equal. A sheet is sized so that
 * every tile is shown at full resolution within the image cap. Pi downscales any image whose long edge exceeds
 * 2000 px, which would thin the labels, so a sheet never goes past that.
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

/**
 * Label band under a tile, as a fraction of the tile's width. A wider tile gets a taller band, so its label
 * fits at the sheet's font size. Measured on the reference set: 0.08 keeps the area ratio lowest among the values tried.
 */
const BAND_RATIO = 0.08;
/**
 * Gap between neighbouring tiles, as a fraction of the sheet's height. Every split uses this same value, so every
 * frame on a sheet is the same width in px. A split's gap is measured in the sheet's own units, not the split's.
 */
const GUTTER = 0.008;
/**
 * Weight of the sheet's shape against the area evenness. A sheet that is far from square uses fewer patches
 * than the budget allows, so its tiles and labels come out smaller for the same tokens. Measured on random
 * sets: weight 1 keeps the area spread within about 7% of weight 0, and brings the sheet to about 1:1 when
 * the images share one shape ([ADR 0010](../docs/adr/0010-square-sheet-uniform-gutters.md)).
 */
const SHAPE_WEIGHT = 1;

/** Position and size of one tile. Pixel coordinates; x1 and y1 are exclusive. */
export interface Tile {
	/** Index into the aspect and height arrays given to planLayout. */
	index: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** Height in px of the label band directly under the tile, starting at y1. */
	band: number;
}

export interface Layout {
	width: number;
	height: number;
	/** Font size for labels on this sheet, before any shrinking to fit a tile's band or width. */
	labelPx: number;
	tiles: Tile[];
}

/** Element at `i`. Throws instead of returning undefined, so an indexing bug cannot pass silently. */
function at<T>(xs: readonly T[], i: number): T {
	if (i < 0 || i >= xs.length) throw new RangeError(`index ${i} out of range (length ${xs.length})`);
	return xs[i] as T;
}

/** Whether a sheet of this size is within the budget. */
export function fits(width: number, height: number): boolean {
	const cols = Math.ceil(width / PATCH);
	const rows = Math.ceil(height / PATCH);
	return Math.max(cols, rows) * PATCH <= MAX_EDGE && cols * rows <= MAX_PATCHES;
}

/** Label font for a sheet of width W. Scales with W. */
export function metrics(width: number): { labelPx: number } {
	return { labelPx: Math.max(MIN_FONT, Math.round(width * 0.016)) };
}

/**
 * Slice tree over the input indexes. A leaf is an input index; a node splits its rectangle either side by side
 * ("H") or one above the other ("V").
 */
type Tree = number | { op: "H" | "V"; l: Tree; r: Tree };

/** A tile's rectangle in tree units, where the whole sheet is one unit tall. */
interface Cell {
	x: number;
	y: number;
	/** Image width and height. The band sits under the image, width-wide, and is not part of these. */
	w: number;
	h: number;
	band: number;
}

/**
 * Width of a subtree is linear in its height: width = alpha * height + beta. A leaf has beta 0. A side-by-side
 * split adds widths and one gutter, so both coefficients add up. A stacked split solves for the shared width,
 * which keeps the relation linear. The gutter enters beta only, so it is the same in px everywhere.
 */
interface Shape {
	alpha: number;
	beta: number;
}

function shapeOf(tree: Tree, aspects: readonly number[]): Shape {
	if (typeof tree === "number") {
		const a = at(aspects, tree);
		return { alpha: a / (1 + BAND_RATIO * a), beta: 0 };
	}
	const l = shapeOf(tree.l, aspects);
	const r = shapeOf(tree.r, aspects);
	if (tree.op === "H") return { alpha: l.alpha + r.alpha, beta: l.beta + r.beta + GUTTER };
	const alpha = 1 / (1 / l.alpha + 1 / r.alpha);
	return { alpha, beta: alpha * (-GUTTER + l.beta / l.alpha + r.beta / r.alpha) };
}

/**
 * Places every leaf, given the height of a subtree's rectangle (its images and label bands). Its width follows
 * from its shape.
 */
function place(tree: Tree, aspects: readonly number[], x: number, y: number, h: number, out: Cell[]): void {
	if (typeof tree === "number") {
		const a = at(aspects, tree);
		const w = (a / (1 + BAND_RATIO * a)) * h;
		out[tree] = { x, y, w, h: w / a, band: BAND_RATIO * w };
		return;
	}
	const l = shapeOf(tree.l, aspects);
	if (tree.op === "H") {
		const wl = l.alpha * h + l.beta;
		place(tree.l, aspects, x, y, h, out);
		place(tree.r, aspects, x + wl + GUTTER, y, h, out);
	} else {
		const node = shapeOf(tree, aspects);
		const w = node.alpha * h + node.beta;
		const hl = (w - l.beta) / l.alpha;
		place(tree.l, aspects, x, y, hl, out);
		place(tree.r, aspects, x, y + hl + GUTTER, h - hl - GUTTER, out);
	}
}

/** Cells for a tree, in tree units. The root is one unit tall, so its aspect is its width. */
function cellsOf(tree: Tree, aspects: readonly number[]): { aspect: number; cells: Cell[] } {
	const shape = shapeOf(tree, aspects);
	const aspect = shape.alpha + shape.beta;
	const cells: Cell[] = [];
	place(tree, aspects, 0, 0, 1, cells);
	return { aspect, cells };
}

/**
 * Largest scale s (px per tree unit) at which the sheet fits the budget. The sheet is aspect x 1 units,
 * so its px size is (s * aspect) x s.
 */
function budgetScale(aspect: number): number {
	let lo = 1;
	let hi = 2 * MAX_EDGE;
	for (let k = 0; k < 40; k++) {
		const mid = (lo + hi) / 2;
		if (fits(Math.round(mid * aspect), Math.round(mid))) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** Largest scale at which no tile is taller than its source image. */
function sourceScale(cells: readonly Cell[], heights: readonly number[]): number {
	let s = Number.POSITIVE_INFINITY;
	cells.forEach((cell, i) => {
		s = Math.min(s, at(heights, i) / cell.h);
	});
	return s;
}

/** Ratio of the largest to the smallest image area (tree units, so scale-free). Lower is more even. */
function areaSpread(cells: readonly Cell[]): number {
	let lo = Number.POSITIVE_INFINITY;
	let hi = 0;
	for (const cell of cells) {
		const area = cell.w * cell.h;
		lo = Math.min(lo, area);
		hi = Math.max(hi, area);
	}
	return hi / lo;
}

/**
 * How much the search rewards large tiles against even ones. Without the size term, the search can make a thin
 * column of tiles, which is as even as a grid but leaves each image tiny. Measured on the reference set: 0.5 gives
 * an area spread of 1.45, and 1 gives 2.12 for the same sheets.
 */
const SIZE_WEIGHT = 0.5;

/**
 * Search cost, lower is better: image areas as even as possible, the mean tile as large as possible in px,
 * and the sheet close to square.
 */
function cost(tree: Tree, aspects: readonly number[], heights: readonly number[]): number {
	const { aspect, cells } = cellsOf(tree, aspects);
	const scale = Math.min(budgetScale(aspect), sourceScale(cells, heights));
	const meanArea = cells.reduce((sum, c) => sum + c.w * c.h, 0) / cells.length;
	const px = scale * scale * meanArea;
	return Math.log(areaSpread(cells)) - SIZE_WEIGHT * Math.log(px) + SHAPE_WEIGHT * Math.abs(Math.log(aspect));
}

/** A seeded linear congruential generator, so the same input always gives the same layout. */
function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function leavesOf(tree: Tree, out: number[] = []): number[] {
	if (typeof tree === "number") out.push(tree);
	else {
		leavesOf(tree.l, out);
		leavesOf(tree.r, out);
	}
	return out;
}

function countNodes(tree: Tree): number {
	return typeof tree === "number" ? 1 : 1 + countNodes(tree.l) + countNodes(tree.r);
}

/** The tree without leaf `x`. Its parent is replaced by the sibling. */
function without(tree: Tree, x: number): Tree | null {
	if (typeof tree === "number") return tree === x ? null : tree;
	const l = without(tree.l, x);
	const r = without(tree.r, x);
	if (l === null) return r;
	if (r === null) return l;
	return { op: tree.op, l, r };
}

/** Insert leaf `x` beside the node numbered `k` in pre-order, as a new split with the given operator. */
function insertBeside(tree: Tree, k: number, x: number, op: "H" | "V", left: boolean): Tree {
	let seen = 0;
	const go = (node: Tree): Tree => {
		if (seen++ === k) return left ? { op, l: x, r: node } : { op, l: node, r: x };
		if (typeof node === "number") return node;
		return { op: node.op, l: go(node.l), r: go(node.r) };
	};
	return go(tree);
}

/** Flip the operator of the internal node numbered `k` in pre-order. */
function flipAt(tree: Tree, k: number): Tree {
	let seen = 0;
	const go = (node: Tree): Tree => {
		if (typeof node === "number") return node;
		const mine = seen++;
		const l = go(node.l);
		const r = go(node.r);
		return { op: mine === k ? (node.op === "H" ? "V" : "H") : node.op, l, r };
	};
	return go(tree);
}

/** A random tree over the given indexes: repeatedly join two random pieces. */
function randomTree(indexes: readonly number[], rand: () => number): Tree {
	const pieces: Tree[] = [...indexes];
	while (pieces.length > 1) {
		const a = pieces.splice(Math.floor(rand() * pieces.length), 1)[0] as Tree;
		const b = pieces.splice(Math.floor(rand() * pieces.length), 1)[0] as Tree;
		pieces.push({ op: rand() < 0.5 ? "H" : "V", l: a, r: b });
	}
	return at(pieces, 0);
}

const SEARCH_RESTARTS = 6;
const SEARCH_STEPS = 40_000;

/** A neighbour of a tree: move one leaf elsewhere (most of the time), or flip one split. Null if none applies. */
function neighbour(tree: Tree, rand: () => number): Tree | null {
	const leaves = leavesOf(tree);
	if (rand() < 0.8) {
		const x = at(leaves, Math.floor(rand() * leaves.length));
		const pruned = without(tree, x);
		if (pruned === null) return null;
		const k = Math.floor(rand() * countNodes(pruned));
		return insertBeside(pruned, k, x, rand() < 0.5 ? "H" : "V", rand() < 0.5);
	}
	const internal = countNodes(tree) - leaves.length;
	return internal === 0 ? null : flipAt(tree, Math.floor(rand() * internal));
}

/** One annealing run from a random tree. Returns the best tree it visited. */
function anneal(aspects: readonly number[], heights: readonly number[], seed: number): { tree: Tree; cost: number } {
	const rand = generator(seed);
	let current = randomTree(
		aspects.map((_, i) => i),
		rand,
	);
	let currentCost = cost(current, aspects, heights);
	let best = { tree: current, cost: currentCost };
	for (let step = 0; step < SEARCH_STEPS; step++) {
		const candidate = neighbour(current, rand);
		if (candidate === null) continue;
		const candidateCost = cost(candidate, aspects, heights);
		const temperature = 0.05 * (0.001 / 0.05) ** (step / SEARCH_STEPS);
		if (candidateCost < currentCost || rand() < Math.exp((currentCost - candidateCost) / temperature)) {
			current = candidate;
			currentCost = candidateCost;
			if (currentCost < best.cost) best = { tree: current, cost: currentCost };
		}
	}
	return best;
}

/** Best slice tree over several fixed-seed runs. Fixed seeds keep the result deterministic. */
function searchTree(aspects: readonly number[], heights: readonly number[]): Tree {
	let best: { tree: Tree; cost: number } | null = null;
	for (let restart = 1; restart <= SEARCH_RESTARTS; restart++) {
		const run = anneal(aspects, heights, restart);
		if (best === null || run.cost < best.cost) best = run;
	}
	if (best === null) throw new Error("no search run");
	return best.tree;
}

/**
 * Choose the slice tree and the sheet scale that show the most image pixels within the budget, with the image
 * areas as even as the search can make them.
 *
 * A tile never grows taller than its source, so a small image is not upscaled to fill space.
 * Returns null when there are no tiles.
 */
export function planLayout(aspects: readonly number[], heights: readonly number[]): Layout | null {
	if (aspects.length === 0) return null;
	const tree = aspects.length === 1 ? 0 : searchTree(aspects, heights);
	const { aspect, cells } = cellsOf(tree, aspects);
	const scale = Math.min(budgetScale(aspect), sourceScale(cells, heights));
	const width = Math.round(scale * aspect);
	const height = Math.round(scale);
	const tiles: Tile[] = cells.map((cell, index) => {
		const x0 = Math.round(cell.x * scale);
		const y0 = Math.round(cell.y * scale);
		const x1 = Math.round((cell.x + cell.w) * scale);
		const y1 = Math.round((cell.y + cell.h) * scale);
		const bandBottom = Math.round((cell.y + cell.h + cell.band) * scale);
		return { index, x0, y0, x1, y1, band: bandBottom - y1 };
	});
	return { width, height, labelPx: metrics(width).labelPx, tiles };
}
