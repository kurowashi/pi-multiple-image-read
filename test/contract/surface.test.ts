/**
 * Contract: the model-facing surface stays exactly what the ADR decided.
 *
 * One tool, one required parameter and one optional paging offset. The tool description and parameter list
 * are paid for on every request, so they are pinned here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadExtension, loadTools } from "../helpers/extension.ts";

/** The whole model-facing surface. Adding a tool is a decision that updates this list. */
const EXPECTED_TOOLS = ["read_images"];

/**
 * The description is sent on every request, and its only job is to tell the model when to pick this
 * tool over `read`. It must not describe the tool's output, labels, or limits; the reply text does that.
 * The cap keeps later edits from growing it back.
 */
const MAX_DESCRIPTION_CHARS = 140;

/** The exact top-level parameter names; a rename is a model-facing surface change. */
const EXPECTED_PARAMETERS = ["paths", "offset"];

interface SchemaShape {
	type?: string;
	properties?: Record<string, unknown>;
	required?: string[];
	additionalProperties?: unknown;
}

test("the extension registers exactly one tool", async () => {
	const tools = await loadTools();
	assert.deepEqual([...tools.keys()].sort(), EXPECTED_TOOLS);
});

test("the extension registers no commands and no event handlers", async () => {
	const extension = await loadExtension();
	assert.deepEqual([...extension.commands.keys()], []);
	assert.deepEqual([...extension.handlers.keys()], []);
});

test("the tool has a label, a description within the cap, and an object schema", async () => {
	const [tool] = [...(await loadTools()).values()];
	assert.ok(tool, "the tool must be registered");
	assert.ok(tool.label.length > 0, "read_images needs a label");
	assert.ok(tool.description.length > 0, "read_images needs a description");
	assert.ok(
		tool.description.length <= MAX_DESCRIPTION_CHARS,
		`read_images description is ${tool.description.length} chars, cap is ${MAX_DESCRIPTION_CHARS}`,
	);
	assert.equal((tool.parameters as SchemaShape).type, "object");
});

test("the schema is closed, exposes exactly the decided parameters, and requires only paths", async () => {
	const [tool] = [...(await loadTools()).values()];
	assert.ok(tool, "the tool must be registered");
	const schema = tool.parameters as SchemaShape;
	assert.equal(schema.additionalProperties, false, "read_images must reject unknown parameters");
	assert.deepEqual(Object.keys(schema.properties ?? {}), EXPECTED_PARAMETERS);
	assert.deepEqual(schema.required, ["paths"]);
});
