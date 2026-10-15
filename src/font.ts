/**
 * Picks the font for tile labels. Labels are file names, which are often Japanese, so the font must have CJK glyphs.
 *
 * Fonts come from the operating system, which @napi-rs/canvas loads at import time. Nothing is bundled.
 * Bundling a CJK font would add 2 MB (JIS level 1 subset) to 16 MB (full Japanese) to the install,
 * so the plugin uses one the user already has. The priority list is explicit because Skia does not
 * fall back to a CJK font for missing glyphs: a generic family name draws Japanese as blank boxes.
 */

import { GlobalFonts } from "@napi-rs/canvas";

/** Families to try in order. The first one installed wins. Noto is first because it is the most common open CJK font. */
const CJK_FAMILIES: readonly string[] = [
	"Noto Sans CJK JP",
	"Noto Sans JP",
	"Droid Sans Fallback",
	"Hiragino Sans",
	"Hiragino Kaku Gothic ProN",
	"Yu Gothic",
	"Meiryo",
];

/** The first installed CJK family, or null when none is installed. */
export function findCjkFamily(): string | null {
	return CJK_FAMILIES.find((family) => GlobalFonts.has(family)) ?? null;
}

/** CSS font shorthand for labels at `px`. Without a CJK family, only ASCII labels can be drawn. */
export function labelFont(px: number, family: string | null): string {
	return family === null ? `${px}px sans-serif` : `${px}px "${family}", sans-serif`;
}
