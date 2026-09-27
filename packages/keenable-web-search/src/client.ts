const DEFAULT_BASE_URL = "https://api.keenable.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface KeenableClientOptions {
	apiKey?: string;
	baseUrl?: string;
	clientSource?: string;
	timeoutMs?: number;
	fetch?: typeof globalThis.fetch;
}

export interface SearchOptions {
	site?: string;
	publishedAfter?: string;
	publishedBefore?: string;
	acquiredAfter?: string;
	acquiredBefore?: string;
	signal?: AbortSignal;
}

export interface ContextOptions {
	maxChars: number;
	maxResults?: number;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	description?: string;
	publishedAt?: string;
	acquiredAt?: string;
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeHost(url: URL): string {
	return url.hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.+$/, "");
}

function mappedIpv4(host: string): string | undefined {
	const dotted = /^(?:0*:)*ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(host);
	if (dotted?.[1]) return dotted[1];
	const hex = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
	if (!hex?.[1] || !hex[2]) return undefined;
	const high = Number.parseInt(hex[1], 16);
	const low = Number.parseInt(hex[2], 16);
	return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateAddress(host: string): boolean {
	const candidate = mappedIpv4(host) ?? host;
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
	if (ipv4) {
		const octets = ipv4.slice(1).map(Number);
		if (octets.some((octet) => octet > 255)) return true;
		const [a = 0, b = 0] = octets;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			a >= 224
		);
	}
	if (candidate === "::" || candidate === "::1") return true;
	return /^f[cd]|^fe[89ab]/i.test(candidate);
}

function resolveBaseUrl(value: string | undefined): string {
	const raw = (value ?? process.env.KEENABLE_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`KEENABLE_API_URL must be an absolute HTTPS URL, got ${JSON.stringify(raw)}`);
	}
	const host = normalizeHost(parsed);
	if (!host) throw new Error(`KEENABLE_API_URL must include a host, got ${JSON.stringify(raw)}`);
	if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(host)) return raw;
	if (parsed.protocol !== "https:") throw new Error(`KEENABLE_API_URL must use HTTPS, got ${JSON.stringify(raw)}`);
	if (BLOCKED_HOSTS.has(host) || isPrivateAddress(host)) {
		throw new Error(`KEENABLE_API_URL must not target a private or internal host: ${JSON.stringify(host)}`);
	}
	return raw;
}

function assertPublicUrl(value: string): void {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`web_fetch requires an absolute URL, got ${JSON.stringify(value)}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`web_fetch requires an HTTP or HTTPS URL, got ${JSON.stringify(value)}`);
	}
	const host = normalizeHost(parsed);
	if (!host) throw new Error(`Refusing to fetch a URL without a host: ${JSON.stringify(value)}`);
	if (BLOCKED_HOSTS.has(host)) throw new Error(`Refusing to fetch private or internal host: ${host}`);
	if (isPrivateAddress(host)) throw new Error(`Refusing to fetch private address: ${host}`);
}

function collapse(value: string): string {
	return value.split(/\s+/).filter(Boolean).join(" ");
}

function sourceHeader(index: number, title: string, url: string, publishedAt?: string): string {
	const header = `[${index}] ${title || "Untitled"} (${url})`;
	return publishedAt ? `${header} - published ${publishedAt}` : header;
}

function contextBlock(header: string, body: string): string {
	return body ? `${header}\n${body}` : header;
}

export class SearchResponse {
	readonly query: string;
	readonly results: SearchResult[];

	constructor(query: string, results: SearchResult[]) {
		this.query = query;
		this.results = results;
	}

	get length(): number {
		return this.results.length;
	}

	cited(options: ContextOptions): SearchResult[] {
		const selected = options.maxResults === undefined ? this.results : this.results.slice(0, options.maxResults);
		const cited: SearchResult[] = [];
		let used = 0;
		for (const [index, result] of selected.entries()) {
			const header = sourceHeader(index + 1, result.title, result.url, result.publishedAt);
			const body = collapse(result.snippet || result.description || "");
			const cost = header.length + (body ? body.length + 1 : 0) + (cited.length ? 2 : 0);
			if (cited.length && used + cost > options.maxChars) break;
			cited.push(result);
			used += cost;
		}
		return cited;
	}

	toContext(options: ContextOptions): string {
		const context = this.cited(options)
			.map((result, index) =>
				contextBlock(
					sourceHeader(index + 1, result.title, result.url, result.publishedAt),
					collapse(result.snippet || result.description || ""),
				),
			)
			.join("\n\n");
		return context.slice(0, options.maxChars).trimEnd();
	}
}

export class Page {
	readonly url: string;
	readonly title: string;
	readonly content: string;
	readonly author: string | undefined;
	readonly publishedAt: string | undefined;

	constructor(url: string, title: string, content: string, author?: string, publishedAt?: string) {
		this.url = url;
		this.title = title;
		this.content = content;
		this.author = author;
		this.publishedAt = publishedAt;
	}

	toContext(options: { maxChars: number }): string {
		const header = sourceHeader(1, this.title, this.url, this.publishedAt);
		const contentBudget = options.maxChars - header.length - 1;
		return contextBlock(header, contentBudget > 0 ? this.content.slice(0, contentBudget).trimEnd() : "");
	}
}

function parseObject(text: string, status: number): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`Keenable returned non-JSON data (${status}): ${JSON.stringify(text.slice(0, 200))}`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Keenable returned an unexpected response (${status})`);
	}
	return value as Record<string, unknown>;
}

function errorDetail(body: string, apiKey: string | undefined): string {
	let detail = body.trim().slice(0, 200);
	try {
		const value: unknown = JSON.parse(body);
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			detail = String(record.message ?? record.error ?? record.detail ?? detail).slice(0, 200);
		}
	} catch {
		// The truncated plain-text body is the best available detail.
	}
	return apiKey ? detail.replaceAll(apiKey, "***") : detail;
}

export class KeenableClient {
	private readonly apiKey: string | undefined;
	private readonly baseUrl: string;
	private readonly clientSource: string;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof globalThis.fetch;

	constructor(options: KeenableClientOptions = {}) {
		this.apiKey = nonEmpty(options.apiKey ?? process.env.KEENABLE_API_KEY)?.trim();
		this.baseUrl = resolveBaseUrl(options.baseUrl);
		this.clientSource = options.clientSource ?? "Dot";
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetchImpl = options.fetch ?? globalThis.fetch;
		if (typeof this.fetchImpl !== "function") throw new Error("Keenable requires a Fetch API implementation");
	}

	async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
		if (!query.trim()) throw new Error("web_search requires a non-empty query");
		const body: Record<string, string> = { query, mode: "pro" };
		for (const [wireName, value] of [
			["site", options.site],
			["published_after", options.publishedAfter],
			["published_before", options.publishedBefore],
			["acquired_after", options.acquiredAfter],
			["acquired_before", options.acquiredBefore],
		] as const) {
			if (value) body[wireName] = value;
		}
		const data = await this.request("search", {
			method: "POST",
			headers: { ...this.headers(), "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: options.signal,
		});
		const rawResults = Array.isArray(data.results) ? data.results : [];
		const results = rawResults
			.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
			.map((item) => ({
				title: String(item.title ?? ""),
				url: String(item.url ?? ""),
				snippet: String(item.snippet ?? ""),
				description: nonEmpty(item.description),
				publishedAt: nonEmpty(item.published_at),
				acquiredAt: nonEmpty(item.acquired_at),
			}));
		return new SearchResponse(nonEmpty(data.query) ?? query, results);
	}

	async fetch(url: string, options: { signal?: AbortSignal } = {}): Promise<Page> {
		assertPublicUrl(url);
		const target = new URL(this.endpoint("fetch"));
		target.searchParams.set("url", url);
		const data = await this.request(
			"fetch",
			{ method: "GET", headers: this.headers(), signal: options.signal },
			target,
		);
		return new Page(
			String(data.url ?? url),
			String(data.title ?? ""),
			String(data.content ?? ""),
			nonEmpty(data.author),
			nonEmpty(data.published_at),
		);
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: "application/json",
			"User-Agent": "dot-keenable-web-search/0.0.1",
			"X-Keenable-Title": this.clientSource,
		};
		if (this.apiKey) headers["X-API-Key"] = this.apiKey;
		return headers;
	}

	private endpoint(name: "search" | "fetch"): string {
		return `${this.baseUrl}/v1/${name}${this.apiKey ? "" : "/public"}`;
	}

	private async request(
		name: "search" | "fetch",
		init: RequestInit,
		url: string | URL = this.endpoint(name),
	): Promise<Record<string, unknown>> {
		const callerSignal = init.signal;
		if (callerSignal?.aborted) throw callerSignal.reason;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		const onAbort = () => controller.abort();
		callerSignal?.addEventListener("abort", onAbort, { once: true });
		let response: Response;
		try {
			response = await this.fetchImpl(url, { ...init, signal: controller.signal });
		} catch (error) {
			if (callerSignal?.aborted) throw error;
			throw new Error(`Could not reach Keenable: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			clearTimeout(timer);
			callerSignal?.removeEventListener("abort", onAbort);
		}
		const text = await response.text();
		if (!response.ok) {
			const label =
				response.status === 429 ? "Keenable rate limit exceeded" : `Keenable API error (${response.status})`;
			const detail = errorDetail(text, this.apiKey);
			throw new Error(detail ? `${label}: ${detail}` : label);
		}
		return parseObject(text, response.status);
	}
}
