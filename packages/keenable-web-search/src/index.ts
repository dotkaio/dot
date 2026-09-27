import { type Static, type TSchema, Type } from "typebox";
import { KeenableClient, type KeenableClientOptions } from "./client.ts";

export type { KeenableClientOptions } from "./client.ts";

export const KEENABLE_WEB_SEARCH_EXTENSION_NAME = "@dotkaio/dot-keenable-web-search";

const DEFAULT_MAX_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 50_000;
const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export interface KeenableToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export interface KeenableToolDefinition<TParams extends TSchema = TSchema> {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	executionMode?: "parallel";
	execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined): Promise<KeenableToolResult>;
}

export interface KeenableExtensionAPI {
	registerTool<TParams extends TSchema>(tool: KeenableToolDefinition<TParams>): void;
}

export type KeenableExtensionFactory = (dot: KeenableExtensionAPI) => void;

const searchParameters = Type.Object({
	query: Type.String({
		minLength: 1,
		description: "Describe the ideal page in natural language rather than entering only keywords.",
	}),
	site: Type.Optional(Type.String({ description: "Restrict results to one domain, such as arxiv.org." })),
	published_after: Type.Optional(
		Type.String({ pattern: DATE_PATTERN, description: "Only pages published on or after this date (YYYY-MM-DD)." }),
	),
	published_before: Type.Optional(
		Type.String({ pattern: DATE_PATTERN, description: "Only pages published on or before this date (YYYY-MM-DD)." }),
	),
	acquired_after: Type.Optional(
		Type.String({ pattern: DATE_PATTERN, description: "Only pages indexed on or after this date (YYYY-MM-DD)." }),
	),
	acquired_before: Type.Optional(
		Type.String({ pattern: DATE_PATTERN, description: "Only pages indexed on or before this date (YYYY-MM-DD)." }),
	),
	max_results: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 20, description: "Maximum number of ranked results to return." }),
	),
	max_chars: Type.Optional(
		Type.Integer({
			minimum: 1_000,
			maximum: MAX_OUTPUT_CHARS,
			description: `Maximum output characters. Defaults to ${DEFAULT_MAX_CHARS}.`,
		}),
	),
});

const fetchParameters = Type.Object({
	url: Type.String({ description: "Absolute HTTP or HTTPS URL of the page to read." }),
	max_chars: Type.Optional(
		Type.Integer({
			minimum: 1_000,
			maximum: MAX_OUTPUT_CHARS,
			description: `Maximum output characters. Defaults to ${DEFAULT_MAX_CHARS}.`,
		}),
	),
});

export function createKeenableWebSearchExtension(options: KeenableClientOptions = {}): KeenableExtensionFactory {
	return (dot): void => {
		const client = new KeenableClient({ ...options, clientSource: options.clientSource ?? "Dot" });

		dot.registerTool({
			name: "web_search",
			label: "Web Search",
			description:
				"Search the live web with Keenable for current, citable information. Returns ranked sources with titles, URLs, publication dates, and extracted page text.",
			promptSnippet: "Search the live web for current, citable information",
			promptGuidelines: [
				"Use web_search when an answer depends on current or uncertain online information.",
				"Prefer primary and official sources, then use web_fetch to read the strongest sources before making claims.",
				"Cite source URLs in research answers.",
			],
			parameters: searchParameters,
			executionMode: "parallel",
			async execute(_toolCallId, params, signal) {
				const response = await client.search(params.query, {
					site: params.site,
					publishedAfter: params.published_after,
					publishedBefore: params.published_before,
					acquiredAfter: params.acquired_after,
					acquiredBefore: params.acquired_before,
					signal,
				});
				const contextOptions = {
					maxChars: params.max_chars ?? DEFAULT_MAX_CHARS,
					maxResults: params.max_results,
				};
				const citedResults = response.cited(contextOptions);
				const text = response.toContext(contextOptions);
				return {
					content: [{ type: "text", text: text || `No web results found for: ${params.query}` }],
					details: {
						query: response.query,
						resultCount: response.length,
						citedUrls: citedResults.map((result) => result.url),
					},
				};
			},
		});

		dot.registerTool({
			name: "web_fetch",
			label: "Web Fetch",
			description:
				"Fetch one public web page with Keenable and return its main content as citable markdown. Use after web_search when a result snippet is insufficient.",
			promptSnippet: "Read a public web page as citable markdown",
			parameters: fetchParameters,
			executionMode: "parallel",
			async execute(_toolCallId, params, signal) {
				const page = await client.fetch(params.url, { signal });
				const text = page.toContext({ maxChars: params.max_chars ?? DEFAULT_MAX_CHARS });
				return {
					content: [{ type: "text", text }],
					details: {
						url: page.url,
						title: page.title,
						author: page.author,
						publishedAt: page.publishedAt,
					},
				};
			},
		});
	};
}

const keenableWebSearchExtension = createKeenableWebSearchExtension();

export default keenableWebSearchExtension;
