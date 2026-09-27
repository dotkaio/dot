import { KEENABLE_WEB_SEARCH_EXTENSION_NAME } from "@dotkaio/dot-keenable-web-search";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import { getBuiltInExtensions } from "../src/extensions/index.ts";

describe("keenable web search built-in extension", () => {
	it("loads web_search and web_fetch from the default built-in registry", async () => {
		const builtIn = getBuiltInExtensions(undefined).find(
			(extension) => typeof extension !== "function" && extension.name === KEENABLE_WEB_SEARCH_EXTENSION_NAME,
		);
		expect(builtIn).toBeDefined();
		if (!builtIn || typeof builtIn === "function") {
			throw new Error(`Missing ${KEENABLE_WEB_SEARCH_EXTENSION_NAME} built-in extension`);
		}

		const extension = await loadExtensionFromFactory(
			builtIn.factory,
			process.cwd(),
			createEventBus(),
			createExtensionRuntime(),
			`<inline:${KEENABLE_WEB_SEARCH_EXTENSION_NAME}>`,
		);

		expect([...extension.tools.keys()].sort()).toEqual(["web_fetch", "web_search"]);
		expect(extension.tools.get("web_search")?.definition.promptGuidelines).toContain(
			"Cite source URLs in research answers.",
		);
	});
});
