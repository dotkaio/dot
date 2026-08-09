import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsconfig = JSON.parse(readFileSync(resolve(repoRoot, "tsconfig.json"), "utf8"));
const pathEntries = Object.entries(tsconfig.compilerOptions.paths)
	.filter(([, targets]) => targets.some((target) => target.startsWith("./packages/")))
	.map(([pattern, targets]) => {
		const wildcardIndex = pattern.indexOf("*");
		return {
			pattern,
			prefix: wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex),
			suffix: wildcardIndex === -1 ? "" : pattern.slice(wildcardIndex + 1),
			targets,
		};
	});

function resolveCandidate(candidate) {
	const absolutePath = resolve(repoRoot, candidate);
	for (const path of [absolutePath, `${absolutePath}.ts`, resolve(absolutePath, "index.ts")]) {
		if (existsSync(path) && statSync(path).isFile()) return path;
	}
	return undefined;
}

function resolveWorkspaceSource(specifier) {
	if (!specifier.startsWith("@dotkaio/")) return undefined;
	for (const { pattern, prefix, suffix, targets } of pathEntries) {
		let wildcard = "";
		if (pattern.includes("*")) {
			if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
			wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
		} else if (specifier !== pattern) {
			continue;
		}

		for (const target of targets) {
			const sourcePath = resolveCandidate(target.replace("*", wildcard));
			if (sourcePath) return sourcePath;
		}
	}
	return undefined;
}

registerHooks({
	resolve(specifier, context, nextResolve) {
		const sourcePath = resolveWorkspaceSource(specifier);
		if (!sourcePath) return nextResolve(specifier, context);
		return { shortCircuit: true, url: pathToFileURL(sourcePath).href };
	},
});
