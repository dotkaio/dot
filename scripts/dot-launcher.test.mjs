import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("dot.sh downloads and runs a verified release without Node", { skip: process.platform === "win32" }, async () => {
	const tempRoot = await mkdtemp(join(tmpdir(), "dot-launcher-bootstrap-test-"));
	try {
		const checkout = join(tempRoot, "checkout");
		const scriptsDir = join(checkout, "scripts");
		const fakeBin = join(tempRoot, "bin");
		const releaseDir = join(tempRoot, "release");
		const archiveRoot = join(tempRoot, "archive", "dot");
		const cacheDir = join(tempRoot, "cache");
		const outputPath = join(tempRoot, "runtime-invocation.txt");
		const os = process.platform === "darwin" ? "darwin" : "linux";
		const arch = process.arch === "arm64" ? "arm64" : "x64";
		const asset = `dot-${os}-${arch}.tar.gz`;
		await mkdir(scriptsDir, { recursive: true });
		await mkdir(fakeBin, { recursive: true });
		await mkdir(releaseDir, { recursive: true });
		await mkdir(archiveRoot, { recursive: true });
		await copyFile(dotScript, join(checkout, "dot.sh"));
		await copyFile(join(repoRoot, "scripts", "bootstrap-runtime.sh"), join(scriptsDir, "bootstrap-runtime.sh"));
		await writeFile(
			join(archiveRoot, "dot"),
			`#!/bin/sh
printf 'cwd=%s\\n' "$PWD" > "$DOT_LAUNCHER_TEST_OUTPUT"
printf 'openai=%s\\n' "\${OPENAI_API_KEY+set}" >> "$DOT_LAUNCHER_TEST_OUTPUT"
printf 'arg=%s\\n' "$@" >> "$DOT_LAUNCHER_TEST_OUTPUT"
`,
		);
		await chmod(join(archiveRoot, "dot"), 0o755);
		const tarResult = spawnSync("tar", ["-czf", join(releaseDir, asset), "-C", join(tempRoot, "archive"), "dot"], {
			encoding: "utf8",
		});
		assert.equal(tarResult.status, 0, tarResult.stderr);
		const checksum = createHash("sha256").update(await readFile(join(releaseDir, asset))).digest("hex");
		await writeFile(join(releaseDir, "SHA256SUMS"), `${checksum}  ${asset}\n`);
		await writeFile(
			join(fakeBin, "curl"),
			`#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output) output="$2"; shift 2 ;;
		--write-out) shift 2 ;;
		--*) shift ;;
		*) url="$1"; shift ;;
	esac
done
case "$url" in
	*/releases/latest) printf '%s' 'https://example.test/dotkaio/dot/releases/tag/v1.2.3' ;;
	*) cp "$DOT_FAKE_RELEASE_DIR/\${url##*/}" "$output" ;;
esac
`,
		);
		await chmod(join(checkout, "dot.sh"), 0o755);
		await chmod(join(scriptsDir, "bootstrap-runtime.sh"), 0o755);
		await chmod(join(fakeBin, "curl"), 0o755);

		const result = spawnSync(join(checkout, "dot.sh"), ["--no-env", "--version", "two words"], {
			cwd: tempRoot,
			encoding: "utf8",
			env: {
				...process.env,
				DOT_BOOTSTRAP_CACHE_DIR: cacheDir,
				DOT_BOOTSTRAP_GITHUB_URL: "https://example.test",
				DOT_FAKE_RELEASE_DIR: releaseDir,
				DOT_LAUNCHER_TEST_OUTPUT: outputPath,
				OPENAI_API_KEY: "test-secret",
				PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
			},
		});

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, new RegExp(`downloading v1\\.2\\.3 for ${os}-${arch}`));
		assert.match(result.stdout, /Running without API keys/);
		assert.deepEqual((await readFile(outputPath, "utf8")).trim().split("\n"), [
			`cwd=${realpathSync(tempRoot)}`,
			"openai=",
			"arg=--version",
			"arg=two words",
		]);
		assert.equal((await readFile(join(cacheDir, "current"), "utf8")).trim(), "v1.2.3");
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
});

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
