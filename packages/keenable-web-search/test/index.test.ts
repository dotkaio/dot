import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import keenableWebSearchExtension, {
	createKeenableWebSearchExtension,
	KEENABLE_WEB_SEARCH_EXTENSION_NAME,
	type KeenableClientOptions,
	type KeenableExtensionAPI,
	type KeenableExtensionFactory,
	type KeenableToolDefinition,
} from "../src/index.ts";

interface CapturedRequest {
	url: string;
	init: RequestInit | undefined;
}

function requestUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function collectTools(fetch: typeof globalThis.fetch, apiKey?: string): KeenableToolDefinition[] {
	const tools: KeenableToolDefinition[] = [];
	const dot: KeenableExtensionAPI = {
		registerTool(tool) {
			tools.push(tool as KeenableToolDefinition);
		},
	};
	createKeenableWebSearchExtension({ fetch, apiKey })(dot);
	return tools;
}

function findTool(tools: KeenableToolDefinition[], name: string): KeenableToolDefinition {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Missing tool: ${name}`);
	return tool;
}

describe("keenable web search extension", () => {
	it("publishes the extension factory through a canonical package contract", () => {
		const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			name: string;
			main: string;
			types: string;
			exports: Record<string, unknown>;
			dot: { extensions: string[] };
		};
		const options: KeenableClientOptions = {};
		const factory: KeenableExtensionFactory = createKeenableWebSearchExtension(options);

		expect(packageJson.name).toBe(KEENABLE_WEB_SEARCH_EXTENSION_NAME);
		expect(packageJson.main).toBe("./dist/index.js");
		expect(packageJson.types).toBe("./dist/index.d.ts");
		expect(packageJson.exports).toMatchObject({
			".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
			"./package.json": "./package.json",
		});
		expect(packageJson.dot.extensions).toEqual(["./dist/index.js"]);
		expect(typeof factory).toBe("function");
		expect(typeof keenableWebSearchExtension).toBe("function");
	});

	it("registers keyless search and returns bounded citable results", async () => {
		const requests: CapturedRequest[] = [];
		const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: requestUrl(input), init });
			return Response.json({
				query: "Dot release notes",
				mode: "pro",
				results: [
					{
						title: "Official Dot changelog",
						url: "https://example.com/changelog",
						snippet: "Current release details",
						published_at: "2026-08-15",
					},
				],
			});
		}) as typeof globalThis.fetch;
		const tool = findTool(collectTools(fetch), "web_search");

		const result = await tool.execute(
			"search-1",
			{
				query: "Dot release notes",
				site: "example.com",
				published_after: "2026-08-01",
				max_results: 1,
				max_chars: 2_000,
			},
			undefined,
		);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://api.keenable.ai/v1/search/public");
		expect(requests[0]?.init?.headers).toMatchObject({ "X-Keenable-Title": "Dot" });
		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
			query: "Dot release notes",
			mode: "pro",
			site: "example.com",
			published_after: "2026-08-01",
		});
		expect(result.content).toEqual([
			{
				type: "text",
				text: "[1] Official Dot changelog (https://example.com/changelog) - published 2026-08-15\nCurrent release details",
			},
		]);
		expect(result.details).toEqual({
			query: "Dot release notes",
			resultCount: 1,
			citedUrls: ["https://example.com/changelog"],
		});
	});

	it("uses authenticated fetch and refuses private targets", async () => {
		const requests: CapturedRequest[] = [];
		const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: requestUrl(input), init });
			return Response.json({
				url: "https://example.com/article",
				title: "Primary source",
				content: "Full page content",
				author: "Example Author",
				published_at: "2026-08-15",
			});
		}) as typeof globalThis.fetch;
		const tool = findTool(collectTools(fetch, "secret"), "web_fetch");

		const result = await tool.execute("fetch-1", { url: "https://example.com/article", max_chars: 2_000 }, undefined);

		expect(requests[0]?.url).toBe("https://api.keenable.ai/v1/fetch?url=https%3A%2F%2Fexample.com%2Farticle");
		expect(requests[0]?.init?.headers).toMatchObject({ "X-API-Key": "secret", "X-Keenable-Title": "Dot" });
		expect(result.content[0]).toEqual({
			type: "text",
			text: "[1] Primary source (https://example.com/article) - published 2026-08-15\nFull page content",
		});

		await expect(tool.execute("fetch-private", { url: "http://127.0.0.1/private" }, undefined)).rejects.toThrow(
			"Refusing to fetch private address",
		);
		expect(requests).toHaveLength(1);
	});

	it("strictly bounds an oversized first search result", async () => {
		const fetch = (async () =>
			Response.json({
				query: "large result",
				results: [
					{
						title: "Large source",
						url: "https://example.com/large",
						snippet: "x".repeat(5_000),
					},
				],
			})) as typeof globalThis.fetch;
		const tool = findTool(collectTools(fetch), "web_search");

		const result = await tool.execute("search-large", { query: "large result", max_chars: 1_000 }, undefined);

		expect(result.content[0]?.text).toHaveLength(1_000);
		expect(result.details.citedUrls).toEqual(["https://example.com/large"]);
	});

	it("does not start a request when cancellation already happened", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const tool = findTool(collectTools(fetch), "web_search");
		const controller = new AbortController();
		controller.abort();

		await expect(tool.execute("search-aborted", { query: "cancelled" }, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
