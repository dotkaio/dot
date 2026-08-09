import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dotScript = join(repoRoot, "dot.sh");
const sourcePathsRegister = join(repoRoot, "scripts", "register-source-paths.mjs");

test(
	"dot.sh launches with native Node, compile caching, and filtered arguments",
	{ skip: process.platform === "win32" },
	async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "dot-launcher-test-"));
		try {
			const fakeNode = join(tempRoot, "node");
			const outputPath = join(tempRoot, "invocation.txt");
			await writeFile(
				fakeNode,
				`#!/bin/sh
printf 'cache=%s\\n' "$NODE_COMPILE_CACHE" > "$DOT_LAUNCHER_TEST_OUTPUT"
printf 'openai=%s\\n' "\${OPENAI_API_KEY+set}" >> "$DOT_LAUNCHER_TEST_OUTPUT"
printf 'arg=%s\\n' "$@" >> "$DOT_LAUNCHER_TEST_OUTPUT"
`,
			);
			await chmod(fakeNode, 0o755);

			const env = {
				...process.env,
				DOT_LAUNCHER_TEST_OUTPUT: outputPath,
				OPENAI_API_KEY: "test-secret",
				PATH: `${tempRoot}${delimiter}${process.env.PATH ?? ""}`,
			};
			delete env.NODE_COMPILE_CACHE;

			const result = spawnSync(dotScript, ["--no-env", "--version", "two words"], {
				cwd: repoRoot,
				encoding: "utf8",
				env,
			});
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /Running without API keys/);
			assert.deepEqual((await readFile(outputPath, "utf8")).trim().split("\n"), [
				`cache=${join(repoRoot, "node_modules", ".cache", "dot-node-compile-cache")}`,
				"openai=",
				"arg=--import",
				`arg=${join(repoRoot, "scripts", "register-source-paths.mjs")}`,
				`arg=${join(repoRoot, "packages", "coding-agent", "src", "cli.ts")}`,
				"arg=--version",
				"arg=two words",
			]);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	},
);

test("source path register resolves workspace packages to live TypeScript sources", () => {
	const specifiers = [
		"@dotkaio/dot-ai",
		"@dotkaio/dot-ai/providers/all",
		"@dotkaio/dot-agent-core",
		"@dotkaio/dot-tui",
		"@dotkaio/dot/core/compaction",
	];
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			sourcePathsRegister,
			"--input-type=module",
			"--eval",
			`console.log(JSON.stringify(${JSON.stringify(specifiers)}.map((specifier) => import.meta.resolve(specifier))))`,
		],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), [
		pathToFileURL(join(repoRoot, "packages", "ai", "src", "index.ts")).href,
		pathToFileURL(join(repoRoot, "packages", "ai", "src", "providers", "all.ts")).href,
		pathToFileURL(join(repoRoot, "packages", "agent", "src", "index.ts")).href,
		pathToFileURL(join(repoRoot, "packages", "tui", "src", "index.ts")).href,
		pathToFileURL(join(repoRoot, "packages", "coding-agent", "src", "core", "compaction", "index.ts")).href,
	]);
});
