/**
 * Contract: the dependency allowance and the import boundary.
 *
 * This plugin has one runtime dependency, @napi-rs/canvas, which decodes and
 * draws images. Everything else is pinned to Pi-supplied packages and Node
 * builtins. The allowance is recorded in docs/adr/0001 and changes only with it.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PACKAGE_ROOT } from "../helpers/extension.ts";

/** Runtime dependencies, each justified in an ADR. Keep this list at one entry unless an ADR adds another. */
const ALLOWED_RUNTIME_DEPENDENCIES = new Set(["@napi-rs/canvas"]);

/** Pi supplies these to extensions; anything else must be justified in an ADR. */
const ALLOWED_PEER_DEPENDENCIES = new Set(["@earendil-works/pi-coding-agent", "typebox"]);

/** Node builtins `src` may import. Filesystem access is needed to read image files. */
const ALLOWED_NODE_BUILTINS = new Set(["node:fs", "node:os", "node:path"]);

/** Development tooling allowlist. Adding one is a decision, not an accident. */
const ALLOWED_DEV_DEPENDENCIES = new Set([
	"@biomejs/biome",
	"@earendil-works/pi-coding-agent",
	"@types/node",
	"knip",
	"lefthook",
	"typebox",
	"typescript",
]);

interface Manifest {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Manifest;

test("runtime dependencies are exactly the allowlisted set, and pinned", () => {
	const declared = manifest.dependencies ?? {};
	assert.deepEqual(Object.keys(declared).sort(), [...ALLOWED_RUNTIME_DEPENDENCIES].sort());
	for (const [name, version] of Object.entries(declared)) {
		assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version, not a range`);
	}
});

test("every dev dependency is on the allowlist", () => {
	for (const name of Object.keys(manifest.devDependencies ?? {})) {
		assert.ok(
			ALLOWED_DEV_DEPENDENCIES.has(name),
			`dev dependency ${name} is not allowlisted; record the decision first`,
		);
	}
});

test("every peer dependency is supplied by Pi", () => {
	for (const name of Object.keys(manifest.peerDependencies ?? {})) {
		assert.ok(ALLOWED_PEER_DEPENDENCIES.has(name), `peer dependency ${name} is not supplied by Pi`);
	}
});

test("source imports only allowlisted builtins, relative files, and declared packages", () => {
	const offenders: string[] = [];
	for (const file of listSourceFiles(join(PACKAGE_ROOT, "src"))) {
		const source = readFileSync(file, "utf8");
		for (const specifier of extractImportSpecifiers(source)) {
			if (isAllowedSpecifier(specifier)) continue;
			offenders.push(`${file.replace(PACKAGE_ROOT, ".")}: ${specifier}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		"imports must resolve from an allowlisted package, Node builtin, or relative .ts file",
	);
});

function isAllowedSpecifier(specifier: string): boolean {
	if (specifier.startsWith("node:")) return ALLOWED_NODE_BUILTINS.has(specifier);
	if (specifier.startsWith(".")) return specifier.endsWith(".ts");
	const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
	if (packageName === undefined) return false;
	return ALLOWED_PEER_DEPENDENCIES.has(packageName) || ALLOWED_RUNTIME_DEPENDENCIES.has(packageName);
}

function extractImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	// Static imports in both quote styles, plus `import()` and `require()`.
	const pattern = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
	for (const match of source.matchAll(pattern)) {
		const specifier = match[1];
		if (specifier !== undefined) specifiers.push(specifier);
	}
	return specifiers;
}

function listSourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => join(entry.parentPath, entry.name));
}
