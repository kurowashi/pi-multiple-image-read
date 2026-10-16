/**
 * pi-multiple-image-read — one tool that shows many local images in as few tool results as the image budget allows.
 *
 * `read_images` takes files, directories, or globs, and returns labelled contact sheets. Each sheet is sized to
 * Anthropic's standard image budget, so the model sees every tile at full resolution.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readImages } from "./read-images.ts";

export default function multipleImageReadExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read_images",
		label: "Read images",
		description:
			"Show local images as labelled contact sheets, 48 per call. Accepts files, directories, or globs. " +
			"Labels show file names; the text lists only images whose label is cut off, not drawn, or shared, and skipped files. Use offset for more.",
		parameters: Type.Object(
			{
				paths: Type.Array(Type.String(), {
					minItems: 1,
					description: "Image files, directories, or glob patterns (e.g. /tmp/shots/*.png).",
				}),
				offset: Type.Optional(
					Type.Integer({
						minimum: 0,
						description: "Skip this many images first. Use the offset the previous reply gives for the rest.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, { paths, offset }) => ({
			content: await readImages(paths, { offset: offset ?? 0 }),
			details: undefined,
		}),
	});
}
