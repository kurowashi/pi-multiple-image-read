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
			"Show local images as labelled contact sheets. Accepts files, directories, or globs (max 48 per call). " +
			"Labels show file names; the text lists only images whose label is cut off, not drawn, or shared, and skipped files. Tiles are small.",
		parameters: Type.Object(
			{
				paths: Type.Array(Type.String(), {
					minItems: 1,
					description: "Image files, directories, or glob patterns (e.g. /tmp/shots/*.png).",
				}),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, { paths }) => ({
			content: await readImages(paths),
			details: undefined,
		}),
	});
}
