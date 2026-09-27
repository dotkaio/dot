import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@dotkaio/dot-ai";
import { KEENABLE_WEB_SEARCH_EXTENSION_NAME } from "@dotkaio/dot-keenable-web-search";
import { afterEach, describe, expect, it } from "vitest";
import {
	filterModelsByRuntimePolicy,
	formatRuntimeModelLock,
	isRuntimeCommandDisabled,
	isRuntimeExtensionDisabled,
	isRuntimeModelAllowed,
	loadRuntimePolicy,
} from "../src/core/runtime-policy.ts";
import { getEnabledBuiltinSlashCommands } from "../src/core/slash-commands.ts";
import { getBuiltInExtensions } from "../src/extensions/index.ts";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function model(provider: string, id: string): Model<Api> {
	return { provider, id } as Model<Api>;
}

describe("runtime policy", () => {
	it("loads and normalizes a locked-down installation policy", () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-policy-"));
		tempDirectories.push(directory);
		const path = join(directory, "policy.json");
		writeFileSync(
			path,
			JSON.stringify({
				footerLabel: " Abiy's agent ",
				lockedModel: {
					provider: "vercel-ai-gateway",
					id: "deepseek/deepseek-v4-flash-0731",
				},
				disabledCommands: ["/model", "tree", "model"],
				disabledExtensions: [" llama.cpp ", "llama.cpp"],
				cleanStartup: true,
			}),
		);

		const policy = loadRuntimePolicy(path);
		expect(policy).toEqual({
			footerLabel: "Abiy's agent",
			lockedModel: {
				provider: "vercel-ai-gateway",
				id: "deepseek/deepseek-v4-flash-0731",
			},
			disabledCommands: ["model", "tree"],
			disabledExtensions: ["llama.cpp"],
			cleanStartup: true,
		});
		expect(formatRuntimeModelLock(policy)).toBe("vercel-ai-gateway/deepseek/deepseek-v4-flash-0731");
	});

	it("removes disabled built-ins and rejects direct command aliases", () => {
		const policy = { disabledCommands: ["model", "copy", "tree"] };
		const names = getEnabledBuiltinSlashCommands(policy).map((command) => command.name);
		expect(names).not.toContain("model");
		expect(names).not.toContain("copy");
		expect(names).not.toContain("tree");
		expect(names).toContain("settings");
		expect(isRuntimeCommandDisabled("/model", policy)).toBe(true);
	});

	it("removes a disabled built-in extension before it can register capabilities", () => {
		const policy = { disabledExtensions: ["llama.cpp"] };
		expect(getBuiltInExtensions(policy).map((extension) => extension.name)).toEqual([
			KEENABLE_WEB_SEARCH_EXTENSION_NAME,
		]);
		expect(isRuntimeExtensionDisabled("llama.cpp", policy)).toBe(true);
		expect(getBuiltInExtensions(undefined).map((extension) => extension.name)).toEqual([
			"llama.cpp",
			KEENABLE_WEB_SEARCH_EXTENSION_NAME,
		]);
	});

	it("uses the public package name as the Keenable policy identifier", () => {
		const policy = { disabledExtensions: [KEENABLE_WEB_SEARCH_EXTENSION_NAME] };
		expect(getBuiltInExtensions(policy).map((extension) => extension.name)).toEqual(["llama.cpp"]);
	});

	it("rejects a malformed model lock instead of coercing enforcement identifiers", () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-policy-invalid-"));
		tempDirectories.push(directory);
		const path = join(directory, "policy.json");
		writeFileSync(path, JSON.stringify({ lockedModel: { provider: 123, id: {} } }));

		expect(() => loadRuntimePolicy(path)).toThrow("lockedModel requires string provider and id");
	});

	it("exposes and permits only the locked provider/model pair", () => {
		const policy = {
			lockedModel: {
				provider: "vercel-ai-gateway",
				id: "deepseek/deepseek-v4-flash-0731",
			},
		};
		const allowed = model("vercel-ai-gateway", "deepseek/deepseek-v4-flash-0731");
		const other = model("anthropic", "claude-sonnet-4-5");

		expect(filterModelsByRuntimePolicy([other, allowed], policy)).toEqual([allowed]);
		expect(isRuntimeModelAllowed(allowed, policy)).toBe(true);
		expect(isRuntimeModelAllowed(other, policy)).toBe(false);
	});
});
