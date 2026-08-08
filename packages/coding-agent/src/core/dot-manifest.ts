import { readFileSync } from "node:fs";

export interface DotManifest {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readDotManifest(packageJsonPath: string): DotManifest | null {
	try {
		const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
		if (!isObject(pkg)) {
			return null;
		}

		const resourceRoot = isObject(pkg.dot) ? pkg.dot : null;
		if (!resourceRoot) {
			return null;
		}

		const manifest: DotManifest = {};
		for (const field of RESOURCE_FIELDS) {
			const entries = resourceRoot[field];
			if (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")) {
				manifest[field] = entries;
			}
		}
		return manifest;
	} catch {
		return null;
	}
}
