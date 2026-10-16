/**
 * pi-multiple-image-read — one tool that shows many local images in as few tool results as the image budget allows.
 *
 * `read_images` takes files, directories, or globs, and returns labelled contact sheets. Each sheet is at most
 * 2000 px on its long edge, so Pi does not downscale it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readImages } from "./read-images.ts";

export default function multipleImageReadExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read_images",
		label: "Read images",
		description:
			"Use instead of read to view two or more local images (a folder, a glob, or several paths) in one call. For one image, use read.",
		parameters: Type.Object(
			{
				paths: Type.Array(Type.String(), {
					minItems: 1,
					description: "Files, directories, or glob patterns.",
				}),
				offset: Type.Optional(Type.Integer({ minimum: 0 })),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, { paths, offset }) => ({
			content: await readImages(paths, { offset: offset ?? 0 }),
			details: undefined,
		}),
	});
}
