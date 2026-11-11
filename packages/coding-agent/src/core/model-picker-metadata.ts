import { join } from "node:path";
import type { ModelCost } from "@dotkaio/dot-ai";
import { getAgentDir } from "../config.ts";
import { FileAuthStorageBackend } from "./auth-storage.ts";

export interface ModelMetadataItem {
	provider: string;
	id: string;
	model: { name: string; cost: ModelCost };
}

interface VercelGatewayModelMetadata {
	id?: unknown;
	name?: unknown;
	released?: unknown;
	owned_by?: unknown;
	pricing?: unknown;
}

export interface ArtificialAnalysisScores {
	exact: ReadonlyMap<string, number>;
	canonical: ReadonlyMap<string, number>;
}

export interface ArtificialAnalysisDataManifest {
	path: string;
	key: string;
}

interface ArtificialAnalysisFetchResult {
	complete: boolean;
	scores: ArtificialAnalysisScores;
}

interface StoredSource<T> {
	lastAttemptAt: number;
	lastSuccessAt?: number;
	nextRefreshAt: number;
	data: T;
}

interface StoredArtificialAnalysisScores {
	exact: Array<[string, number]>;
	canonical: Array<[string, number]>;
}

interface StoredVercelMetadata {
	releaseDates: Array<[string, string]>;
	costs: Array<[string, ModelCost]>;
}

interface StoredModelPickerMetadata {
	version: number;
	artificialAnalysis?: StoredSource<StoredArtificialAnalysisScores>;
	historicalArtificialAnalysis?: StoredSource<StoredArtificialAnalysisScores>;
	vercel?: StoredSource<StoredVercelMetadata>;
}

interface HttpResponse {
	ok: boolean;
	arrayBuffer(): Promise<ArrayBuffer>;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

const VERCEL_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const ARTIFICIAL_ANALYSIS_MODELS_URL = "https://artificialanalysis.ai/leaderboards/models";
// This article preserves published v4.3 results for models without a current index.
const ARTIFICIAL_ANALYSIS_HISTORY_URL =
	"https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-3";
const MODEL_PICKER_METADATA_CACHE_FILE = "model-picker-metadata.json";
// v1 stored Coding Agent Index scores, which must never be interpreted as IQ.
const MODEL_PICKER_METADATA_CACHE_VERSION = 2;
const MODEL_METADATA_REQUEST_TIMEOUT_MS = 15_000;
export const ARTIFICIAL_ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const VERCEL_MODEL_METADATA_CACHE_TTL_MS = 60 * 60 * 1000;
export const MODEL_METADATA_RETRY_INTERVAL_MS = 15 * 60 * 1000;
let modelPickerMetadataCache: StoredModelPickerMetadata | undefined;
let modelPickerMetadataPromise: Promise<ModelPickerMetadata> | undefined;

const PROVIDER_TO_VERCEL_OWNER: Record<string, string> = {
	"amazon-bedrock": "anthropic",
	anthropic: "anthropic",
	google: "google",
	"google-vertex": "google",
	openai: "openai",
	"openai-codex": "openai",
	xai: "xai",
	groq: "groq",
	mistral: "mistral",
	moonshotai: "moonshotai",
	"moonshotai-cn": "moonshotai",
	zai: "zai",
	"zai-coding-cn": "zai",
};

function formatDateParts(year: number, month: number, day: number): string | undefined {
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return undefined;
	}
	return `${month.toString().padStart(2, "0")}/${day.toString().padStart(2, "0")}/${year}`;
}

function formatDateValue(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
		const date = new Date(milliseconds);
		return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
	}
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	const separated = /(?:^|\D)(\d{4})[-_.](\d{2})[-_.](\d{2})(?:\D|$)/u.exec(trimmed);
	if (separated) {
		return formatDateParts(Number(separated[1]), Number(separated[2]), Number(separated[3]));
	}
	const compact = /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/u.exec(trimmed);
	if (compact) {
		return formatDateParts(Number(compact[1]), Number(compact[2]), Number(compact[3]));
	}
	return undefined;
}

function normalizeVercelModelKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/^global\./u, "")
		.replace(/^models\//u, "")
		.replace(/[._]/gu, "-");
}

function addVercelReleaseDateKey(dates: Map<string, string>, key: string, date: string): void {
	if (!key) return;
	const normalized = normalizeVercelModelKey(key);
	if (!dates.has(normalized)) {
		dates.set(normalized, date);
	}
}

async function fetchHttp(url: string): Promise<HttpResponse> {
	return (await fetch(url, {
		signal: AbortSignal.timeout(MODEL_METADATA_REQUEST_TIMEOUT_MS),
	})) as unknown as HttpResponse;
}

function parseVercelPrice(value: unknown): number | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const perToken = Number(value);
	return Number.isFinite(perToken) && perToken >= 0 ? Number((perToken * 1_000_000).toPrecision(12)) : undefined;
}

function parseVercelCost(value: unknown): ModelCost | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const pricing = value as Record<string, unknown>;
	const input = parseVercelPrice(pricing.input);
	const output = parseVercelPrice(pricing.output);
	if (input === undefined || output === undefined) return undefined;
	return {
		input,
		output,
		cacheRead: parseVercelPrice(pricing.input_cache_read) ?? 0,
		cacheWrite: parseVercelPrice(pricing.input_cache_write) ?? 0,
	};
}

interface VercelMetadataFetchResult {
	complete: boolean;
	releaseDates: Map<string, string>;
	costs: Map<string, ModelCost>;
}

async function fetchVercelMetadata(): Promise<VercelMetadataFetchResult> {
	try {
		const response = await fetchHttp(VERCEL_MODELS_URL);
		if (!response.ok) return { complete: false, releaseDates: new Map(), costs: new Map() };
		const data = (await response.json()) as { data?: unknown };
		const items = Array.isArray(data.data) ? data.data : [];
		const releaseDates = new Map<string, string>();
		const costs = new Map<string, ModelCost>();

		for (const rawItem of items) {
			const item = rawItem as VercelGatewayModelMetadata;
			if (typeof item.id !== "string") continue;

			const cost = parseVercelCost(item.pricing);
			if (cost) costs.set(normalizeVercelModelKey(item.id), cost);

			const date = formatDateValue(item.released);
			if (!date) continue;
			addVercelReleaseDateKey(releaseDates, item.id, date);
			const slashIndex = item.id.indexOf("/");
			if (slashIndex >= 0) addVercelReleaseDateKey(releaseDates, item.id.slice(slashIndex + 1), date);
			if (typeof item.name === "string") addVercelReleaseDateKey(releaseDates, item.name, date);
			if (typeof item.owned_by === "string" && slashIndex >= 0) {
				addVercelReleaseDateKey(releaseDates, `${item.owned_by}/${item.id.slice(slashIndex + 1)}`, date);
			}
		}

		return { complete: costs.size > 0, releaseDates, costs };
	} catch {
		return { complete: false, releaseDates: new Map(), costs: new Map() };
	}
}

export function getReleaseDate(item: ModelMetadataItem, vercelReleaseDates: ReadonlyMap<string, string>): string {
	const vercelOwner = PROVIDER_TO_VERCEL_OWNER[item.provider];
	const keys = [
		item.id,
		item.model.name,
		vercelOwner ? `${vercelOwner}/${item.id}` : undefined,
		item.provider === "vercel-ai-gateway" ? item.id : undefined,
	].filter((key): key is string => typeof key === "string" && key.length > 0);

	for (const key of keys) {
		const date = vercelReleaseDates.get(normalizeVercelModelKey(key));
		if (date) return date;
	}
	return "-";
}

export function emptyArtificialAnalysisScores(): ArtificialAnalysisScores {
	return {
		exact: new Map<string, number>(),
		canonical: new Map<string, number>(),
	};
}

function parseStoredScoreEntries(value: unknown): Map<string, number> | undefined {
	if (!Array.isArray(value)) return undefined;
	const scores = new Map<string, number>();
	for (const entry of value) {
		if (
			!Array.isArray(entry) ||
			entry.length !== 2 ||
			typeof entry[0] !== "string" ||
			typeof entry[1] !== "number" ||
			!Number.isFinite(entry[1]) ||
			entry[1] < 0 ||
			entry[1] > 100
		) {
			return undefined;
		}
		scores.set(entry[0], entry[1]);
	}
	return scores;
}

function parseStoredStringEntries(value: unknown): Map<string, string> | undefined {
	if (!Array.isArray(value)) return undefined;
	const entries = new Map<string, string>();
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
			return undefined;
		}
		entries.set(entry[0], entry[1]);
	}
	return entries;
}

function isStoredModelCost(value: unknown): value is ModelCost {
	if (value === null || typeof value !== "object") return false;
	const cost = value as Record<string, unknown>;
	return [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].every(
		(rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0,
	);
}

function parseStoredCostEntries(value: unknown): Map<string, ModelCost> | undefined {
	if (!Array.isArray(value)) return undefined;
	const entries = new Map<string, ModelCost>();
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isStoredModelCost(entry[1])) {
			return undefined;
		}
		entries.set(entry[0], entry[1]);
	}
	return entries;
}

function parseStoredSource<T>(
	value: unknown,
	parseData: (value: unknown) => T | undefined,
): StoredSource<T> | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const source = value as Record<string, unknown>;
	if (
		typeof source.lastAttemptAt !== "number" ||
		!Number.isFinite(source.lastAttemptAt) ||
		typeof source.nextRefreshAt !== "number" ||
		!Number.isFinite(source.nextRefreshAt) ||
		(source.lastSuccessAt !== undefined &&
			(typeof source.lastSuccessAt !== "number" || !Number.isFinite(source.lastSuccessAt)))
	) {
		return undefined;
	}
	const data = parseData(source.data);
	return data === undefined
		? undefined
		: {
				lastAttemptAt: source.lastAttemptAt,
				lastSuccessAt: source.lastSuccessAt as number | undefined,
				nextRefreshAt: source.nextRefreshAt,
				data,
			};
}

function parseStoredArtificialAnalysis(value: unknown): StoredArtificialAnalysisScores | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const scores = value as Record<string, unknown>;
	const exact = parseStoredScoreEntries(scores.exact);
	const canonical = parseStoredScoreEntries(scores.canonical);
	return exact && canonical ? { exact: [...exact], canonical: [...canonical] } : undefined;
}

function parseStoredVercel(value: unknown): StoredVercelMetadata | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const metadata = value as Record<string, unknown>;
	const releaseDates = parseStoredStringEntries(metadata.releaseDates);
	const costs = parseStoredCostEntries(metadata.costs);
	return releaseDates && costs ? { releaseDates: [...releaseDates], costs: [...costs] } : undefined;
}

function parseModelPickerMetadataCache(content: string | undefined): StoredModelPickerMetadata | undefined {
	if (!content) return undefined;
	try {
		const value = JSON.parse(content) as unknown;
		if (value === null || typeof value !== "object") return undefined;
		const record = value as Record<string, unknown>;
		if (record.version !== MODEL_PICKER_METADATA_CACHE_VERSION) return undefined;
		return {
			version: MODEL_PICKER_METADATA_CACHE_VERSION,
			artificialAnalysis: parseStoredSource(record.artificialAnalysis, parseStoredArtificialAnalysis),
			historicalArtificialAnalysis: parseStoredSource(
				record.historicalArtificialAnalysis,
				parseStoredArtificialAnalysis,
			),
			vercel: parseStoredSource(record.vercel, parseStoredVercel),
		};
	} catch {
		return undefined;
	}
}

export function isArtificialAnalysisCacheFresh(fetchedAt: number, now: number = Date.now()): boolean {
	const age = now - fetchedAt;
	return Number.isFinite(fetchedAt) && age >= 0 && age < ARTIFICIAL_ANALYSIS_CACHE_TTL_MS;
}

function getModelPickerMetadataStorage(): FileAuthStorageBackend {
	return new FileAuthStorageBackend(join(getAgentDir(), MODEL_PICKER_METADATA_CACHE_FILE));
}

function loadModelPickerMetadataCache(): StoredModelPickerMetadata {
	if (modelPickerMetadataCache) return modelPickerMetadataCache;
	let stored: StoredModelPickerMetadata | undefined;
	try {
		stored = getModelPickerMetadataStorage().withLock((content) => ({
			result: parseModelPickerMetadataCache(content),
		}));
	} catch {}
	stored ??= { version: MODEL_PICKER_METADATA_CACHE_VERSION };
	modelPickerMetadataCache = stored;
	return stored;
}

async function writeModelPickerMetadataCache(cache: StoredModelPickerMetadata): Promise<void> {
	modelPickerMetadataCache = cache;
	try {
		await getModelPickerMetadataStorage().withLockAsync(async (content) => {
			const current = parseModelPickerMetadataCache(content);
			const newer = <T>(candidate: StoredSource<T> | undefined, previous: StoredSource<T> | undefined) =>
				(candidate?.lastAttemptAt ?? 0) >= (previous?.lastAttemptAt ?? 0) ? candidate : previous;
			const merged: StoredModelPickerMetadata = {
				version: MODEL_PICKER_METADATA_CACHE_VERSION,
				artificialAnalysis: newer(cache.artificialAnalysis, current?.artificialAnalysis),
				historicalArtificialAnalysis: newer(
					cache.historicalArtificialAnalysis,
					current?.historicalArtificialAnalysis,
				),
				vercel: newer(cache.vercel, current?.vercel),
			};
			modelPickerMetadataCache = merged;
			return { result: undefined, next: JSON.stringify(merged, null, 2) };
		});
	} catch {
		// Keep the latest successful metadata in memory when storage is unavailable.
	}
}

function normalizeArtificialAnalysisKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/^[a-z][a-z\s]+:\s*/u, "")
		.replace(/^models\//u, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

function canonicalizeArtificialAnalysisKey(value: string): string {
	// Preserve dotted Bedrock/provider segments before generic punctuation normalization.
	// e.g. eu.anthropic.claude-haiku-4-5-20251001-v1:0 -> claude-haiku-4-5-20251001-v1
	const preNormalized = value
		.replace(/^(?:[a-z]{2}\.)?(?:anthropic|amazon|deepseek|google|meta|mistral|openai)\./iu, "")
		.replace(/:\d+$/u, "")
		// OpenRouter-style free-tier packaging: model:free
		.replace(/:free$/iu, "");
	let key = normalizeArtificialAnalysisKey(preNormalized);
	// Drop path/provider/region prefixes used by gateway, Bedrock, and Fireworks IDs.
	key = key
		.replace(/^(?:accounts-)?fireworks-(?:models|routers)-/u, "")
		.replace(/^(?:global|us|eu|ap|au|jp|ca|me)-/u, "")
		.replace(/^(?:anthropic|openai|google|xai|meta|amazon|deepseek|mistralai|mistral|zai|z-ai)-/u, "");
	key = key
		.replace(/-\d{4}-\d{2}-\d{2}(?=-|$)/gu, "")
		.replace(/-\d{2}-\d{4}(?=-|$)/gu, "")
		.replace(/-\d{2}-\d{2}(?=-|$)/gu, "")
		// Compact Bedrock/OpenAI dated ids: -20251001, -20251101
		.replace(/-\d{8}(?=-|$)/gu, "")
		// Bedrock style suffixes: -v1, -v1-0, -v2-0
		.replace(/-v\d+(?:-\d+)?(?=-|$)/gu, "");
	// Drop trailing region labels that appear in display names ("... (EU)").
	key = key.replace(/-(?:global|us|eu|ap|au|jp|ca|me)$/u, "");
	let previous: string;
	do {
		previous = key;
		key = key.replace(
			/-(?:default-fallback|with-fallback|adaptive-reasoning|max-effort|non-reasoning|reasoning|highthinking|nothinking|max|xhigh|high|medium|minimal|low|thinking|preview|latest|instruct|chat|free)(?=-|$)/gu,
			"",
		);
	} while (key !== previous);
	// Only known serving variants share scores; e.g. Grok Fast is a distinct model.
	if (key.startsWith("claude-")) key = key.replace(/-(?:fast|batch)$/u, "");
	if (key.startsWith("minimax-")) key = key.replace(/-highspeed$/u, "");
	// Instruct packaging tags (Gemma IT, etc.) are not a distinct AA model identity.
	key = key.replace(/-it$/u, "");
	// MoE size packaging on the same base id (llama-4-scout-17b-16e -> llama-4-scout).
	key = key.replace(/-\d+b-\d+e$/u, "");
	// Fireworks uses p for dots in some model ids (glm-5p2, kimi-k2p6).
	key = key.replace(/(\d)p(\d)/gu, "$1-$2");
	return key.replace(/^-+|-+$/gu, "");
}

/** Orthography variants for zero-padded version segments (nova-2-lite ↔ nova-2-0-lite). */
function expandZeroPaddedVersionVariants(key: string): string[] {
	const parts = key.split("-").filter(Boolean);
	if (parts.length < 2) return [key];
	const variants = new Set<string>([key]);
	for (let i = 0; i < parts.length - 1; i++) {
		if (!/^\d+$/u.test(parts[i])) continue;
		// Strip a single zero pad between a version number and a letter-run token.
		if (parts[i + 1] === "0" && i + 2 < parts.length && /^[a-z]/iu.test(parts[i + 2] ?? "")) {
			variants.add([...parts.slice(0, i + 1), ...parts.slice(i + 2)].join("-"));
		}
		// Insert a zero pad before a letter-run token that follows a version number.
		if (/^[a-z]/iu.test(parts[i + 1] ?? "")) {
			variants.add([...parts.slice(0, i + 1), "0", ...parts.slice(i + 1)].join("-"));
		}
	}
	return [...variants];
}

/** Generate alternate AA keys for common provider/id naming differences. */
function expandArtificialAnalysisKeyVariants(value: string): string[] {
	const base = canonicalizeArtificialAnalysisKey(value);
	if (!base) return [];
	const variants = new Set<string>([base]);

	// Claude Haiku on AA uses claude-4-5-haiku; our ids use claude-haiku-4-5.
	const claudeFamily = /^claude-(opus|sonnet|haiku)-(\d+(?:-\d+)*)$/u.exec(base);
	if (claudeFamily) {
		variants.add(`claude-${claudeFamily[2]}-${claudeFamily[1]}`);
	}
	const claudeReordered = /^claude-(\d+(?:-\d+)*)-(opus|sonnet|haiku)$/u.exec(base);
	if (claudeReordered) {
		variants.add(`claude-${claudeReordered[2]}-${claudeReordered[1]}`);
	}

	// Qwen provider IDs use both qwen-3-* and qwen3-* for the same model family.
	if (/^qwen-\d/u.test(base)) variants.add(base.replace(/^qwen-(?=\d)/u, "qwen"));
	if (/^qwen\d/u.test(base)) variants.add(base.replace(/^qwen(?=\d)/u, "qwen-"));

	// Preserve product tiers (such as o3-pro) and distinct model families.
	variants.add(base.replace(/-effort$/u, ""));

	// Zero-padded version orthography (identity-only; not cross-version).
	for (const variant of [...variants]) {
		for (const zeroPadVariant of expandZeroPaddedVersionVariants(variant)) {
			variants.add(zeroPadVariant);
		}
	}

	return [...variants].filter(Boolean);
}

function setBestScore(scores: Map<string, number>, key: string, score: number): boolean {
	if (!key) return false;
	const existing = scores.get(key);
	if (existing !== undefined && score <= existing) return false;
	scores.set(key, score);
	return true;
}

function collectArtificialAnalysisScoresFromValue(
	value: unknown,
	exact: Map<string, number>,
	canonical: Map<string, number>,
): void {
	if (value === null || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) collectArtificialAnalysisScoresFromValue(item, exact, canonical);
		return;
	}

	const record = value as Record<string, unknown>;
	// Only the published Intelligence Index is IQ. Coding/agent indices and
	// individual benchmark results use different scales and cannot fill gaps.
	const score = parseArtificialAnalysisScore(record.intelligenceIndex);
	if (score !== undefined) {
		for (const identity of [record.slug, record.name, record.shortName]) {
			if (typeof identity !== "string" || !identity) continue;
			setBestScore(exact, normalizeArtificialAnalysisKey(identity), score);
			setBestScore(canonical, canonicalizeArtificialAnalysisKey(identity), score);
		}
	}
	for (const nested of Object.values(record)) {
		collectArtificialAnalysisScoresFromValue(nested, exact, canonical);
	}
}

function extractJsonArraySegment(html: string, startIndex: number): string | undefined {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = startIndex; i < html.length; i++) {
		const char = html[i];
		if (!inString && char === "[") {
			depth += 1;
		}
		if (!inString && char === "]") {
			depth -= 1;
			if (depth === 0) {
				return html.slice(startIndex, i + 1);
			}
		}

		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
		}
	}
	return undefined;
}

function parseArtificialAnalysisInitialDataPayloads(html: string): unknown[] {
	const payloads: unknown[] = [];
	const markers = [/\\"initialData\\":\s*\[/gu, /"initialData":\s*\[/gu];
	for (const marker of markers) {
		for (const match of html.matchAll(marker)) {
			const arrayStart = match[0].lastIndexOf("[");
			const arrayIndex = match.index + arrayStart;
			const arraySegment = extractJsonArraySegment(html, arrayIndex);
			if (!arraySegment) continue;

			const rawText = html.slice(match.index, arrayIndex + arraySegment.length);
			const jsonText = rawText.replace(/\\"/gu, '"').replace(/\\\//gu, "/");
			try {
				const payload = JSON.parse(`{${jsonText}}`) as Record<string, unknown>;
				if (payload?.initialData !== undefined) payloads.push(payload);
			} catch {}
		}
	}
	return payloads;
}

function parseArtificialAnalysisSchemaPayloads(html: string): unknown[] {
	const scriptPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu;
	const payloads: unknown[] = [];
	for (const match of html.matchAll(scriptPattern)) {
		const raw = match[1]?.trim();
		if (!raw) continue;
		try {
			const payload = JSON.parse(raw) as unknown;
			if (payload !== null && typeof payload === "object") {
				payloads.push(payload);
			}
		} catch {}
	}
	return payloads;
}

function parseArtificialAnalysisFlightPayloads(value: string): unknown[] {
	try {
		const direct = JSON.parse(value) as unknown;
		if (direct !== null && typeof direct === "object") return [direct];
	} catch {}

	const payloads: unknown[] = [];
	for (const line of value.split("\n")) {
		const separator = line.indexOf(":");
		if (separator < 0) continue;
		const candidate = line.slice(separator + 1).trim();
		if (!candidate.startsWith("[") && !candidate.startsWith("{")) continue;
		try {
			const payload = JSON.parse(candidate) as unknown;
			if (payload !== null && typeof payload === "object") payloads.push(payload);
		} catch {}
	}
	return payloads;
}

function parseArtificialAnalysisPayloadScoreData(html: string): unknown[] {
	const scriptPattern = /self\.__next_f\.push\(\[1,\s*("(?:(?:\\.|[^"\\])*)")\]\)/gu;
	const payloads: unknown[] = [];
	const flightChunks: string[] = [];
	for (const match of html.matchAll(scriptPattern)) {
		const jsonPayload = match[1];
		if (!jsonPayload) continue;

		let parsedPayload: unknown;
		try {
			parsedPayload = JSON.parse(jsonPayload);
		} catch {
			continue;
		}

		if (typeof parsedPayload === "string") {
			flightChunks.push(parsedPayload);
			payloads.push(...parseArtificialAnalysisFlightPayloads(parsedPayload));
		} else if (parsedPayload !== null && typeof parsedPayload === "object") {
			payloads.push(parsedPayload);
		}
	}

	return [
		...payloads,
		// Next.js can split a single JSON record across multiple script tags.
		...parseArtificialAnalysisFlightPayloads(flightChunks.join("")),
		...parseArtificialAnalysisInitialDataPayloads(html),
		...parseArtificialAnalysisSchemaPayloads(html),
	];
}

function collectArtificialAnalysisDataManifests(
	value: unknown,
	manifests: Map<string, ArtificialAnalysisDataManifest>,
): void {
	if (value === null || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) collectArtificialAnalysisDataManifests(item, manifests);
		return;
	}

	const record = value as Record<string, unknown>;
	if (
		typeof record.path === "string" &&
		record.path.startsWith("/data/") &&
		typeof record.key === "string" &&
		/^[a-f0-9]{64}$/iu.test(record.key)
	) {
		manifests.set(`${record.path}\u0000${record.key}`, { path: record.path, key: record.key });
	}
	for (const nested of Object.values(record)) {
		collectArtificialAnalysisDataManifests(nested, manifests);
	}
}

export function parseArtificialAnalysisDataManifests(html: string): ArtificialAnalysisDataManifest[] {
	const manifests = new Map<string, ArtificialAnalysisDataManifest>();
	for (const payload of parseArtificialAnalysisPayloadScoreData(html)) {
		collectArtificialAnalysisDataManifests(payload, manifests);
	}
	return [...manifests.values()];
}

function hexToBytes(value: string): Uint8Array {
	if (!/^[a-f0-9]{64}$/iu.test(value)) throw new Error("Invalid Artificial Analysis data key");
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < value.length; index += 2) {
		bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
	}
	return bytes;
}

export async function decryptArtificialAnalysisPayload(encrypted: ArrayBuffer, keyHex: string): Promise<unknown> {
	const keyBytes = hexToBytes(keyHex);
	const digest = await crypto.subtle.digest("SHA-256", keyBytes);
	const iv = new Uint8Array(digest).slice(0, 12);
	const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encrypted);
	const decompressed = new Blob([decrypted]).stream().pipeThrough(new DecompressionStream("gzip"));
	return JSON.parse(await new Response(decompressed).text()) as unknown;
}

function parseArtificialAnalysisScore(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const score = Number(value);
	return Number.isFinite(score) && score >= 0 && score <= 100 ? score : undefined;
}

export function parseArtificialAnalysisScores(html: string): ArtificialAnalysisScores {
	const exact = new Map<string, number>();
	const canonical = new Map<string, number>();
	// Include deprecated models: providers can continue serving older releases.
	for (const payload of parseArtificialAnalysisPayloadScoreData(html)) {
		collectArtificialAnalysisScoresFromValue(payload, exact, canonical);
	}

	return { exact, canonical };
}

async function fetchArtificialAnalysisManifest(manifest: ArtificialAnalysisDataManifest): Promise<unknown> {
	const url = new URL(manifest.path, ARTIFICIAL_ANALYSIS_MODELS_URL).href;
	const response = await fetchHttp(url);
	if (!response.ok) throw new Error(`Artificial Analysis data request failed: ${manifest.path}`);
	return decryptArtificialAnalysisPayload(await response.arrayBuffer(), manifest.key);
}

async function fetchArtificialAnalysisScores(url: string): Promise<ArtificialAnalysisFetchResult> {
	try {
		const response = await fetchHttp(url);
		if (!response.ok) return { complete: false, scores: emptyArtificialAnalysisScores() };
		const html = await response.text();
		const pageScores = parseArtificialAnalysisScores(html);
		const manifests = parseArtificialAnalysisDataManifests(html);
		// Launch articles embed their data; the live leaderboard has a full-model
		// manifest that includes historical releases omitted from the initial page.
		if (manifests.length === 0) {
			return { complete: pageScores.exact.size > 0, scores: pageScores };
		}

		const payloads = await Promise.allSettled(manifests.map(fetchArtificialAnalysisManifest));
		const exact = new Map(pageScores.exact);
		const canonical = new Map(pageScores.canonical);
		for (const payload of payloads) {
			if (payload.status === "fulfilled") {
				collectArtificialAnalysisScoresFromValue(payload.value, exact, canonical);
			}
		}
		return {
			complete: payloads.every((payload) => payload.status === "fulfilled") && exact.size > 0,
			scores: { exact, canonical },
		};
	} catch {
		return { complete: false, scores: emptyArtificialAnalysisScores() };
	}
}

function storedArtificialAnalysisScores(scores: ArtificialAnalysisScores): StoredArtificialAnalysisScores {
	return { exact: [...scores.exact], canonical: [...scores.canonical] };
}

function artificialAnalysisScoresFromStored(
	stored: StoredSource<StoredArtificialAnalysisScores> | undefined,
): ArtificialAnalysisScores {
	return stored
		? {
				exact: new Map(stored.data.exact),
				canonical: new Map(stored.data.canonical),
			}
		: emptyArtificialAnalysisScores();
}

function modelPickerMetadataFromStored(cache: StoredModelPickerMetadata): ModelPickerMetadata {
	return {
		artificialAnalysisScores: artificialAnalysisScoresFromStored(cache.artificialAnalysis),
		historicalArtificialAnalysisScores: artificialAnalysisScoresFromStored(cache.historicalArtificialAnalysis),
		vercelReleaseDates: new Map(cache.vercel?.data.releaseDates ?? []),
		vercelCosts: new Map(cache.vercel?.data.costs ?? []),
	};
}

function failedSource<T>(previous: StoredSource<T> | undefined, fallback: T, now: number): StoredSource<T> {
	return {
		lastAttemptAt: now,
		lastSuccessAt: previous?.lastSuccessAt,
		nextRefreshAt: now + MODEL_METADATA_RETRY_INTERVAL_MS,
		data: previous?.data ?? fallback,
	};
}

function refreshedArtificialAnalysisSource(
	previous: StoredSource<StoredArtificialAnalysisScores> | undefined,
	result: ArtificialAnalysisFetchResult,
	now: number,
): StoredSource<StoredArtificialAnalysisScores> {
	if (result.complete && result.scores.exact.size > 0) {
		return {
			lastAttemptAt: now,
			lastSuccessAt: now,
			nextRefreshAt: now + ARTIFICIAL_ANALYSIS_CACHE_TTL_MS,
			data: storedArtificialAnalysisScores(result.scores),
		};
	}
	// A failed manifest must not erase previous scores or discard usable page data.
	// Retain the last complete dataset and retry incomplete refreshes sooner.
	return {
		...failedSource(previous, storedArtificialAnalysisScores(emptyArtificialAnalysisScores()), now),
		data: {
			exact: [...new Map([...(previous?.data.exact ?? []), ...result.scores.exact])],
			canonical: [...new Map([...(previous?.data.canonical ?? []), ...result.scores.canonical])],
		},
	};
}

async function refreshModelPickerMetadata(cache: StoredModelPickerMetadata, now: number): Promise<ModelPickerMetadata> {
	const refreshArtificialAnalysis = !cache.artificialAnalysis || now >= cache.artificialAnalysis.nextRefreshAt;
	const refreshHistory =
		!cache.historicalArtificialAnalysis || now >= cache.historicalArtificialAnalysis.nextRefreshAt;
	const refreshVercel = !cache.vercel || now >= cache.vercel.nextRefreshAt;
	if (process.env.DOT_OFFLINE === "1" || (!refreshArtificialAnalysis && !refreshHistory && !refreshVercel)) {
		return modelPickerMetadataFromStored(cache);
	}

	const [artificialAnalysisResult, historyResult, vercelResult] = await Promise.all([
		refreshArtificialAnalysis
			? fetchArtificialAnalysisScores(ARTIFICIAL_ANALYSIS_MODELS_URL)
			: Promise.resolve(undefined),
		refreshHistory ? fetchArtificialAnalysisScores(ARTIFICIAL_ANALYSIS_HISTORY_URL) : Promise.resolve(undefined),
		refreshVercel ? fetchVercelMetadata() : Promise.resolve(undefined),
	]);
	const updated: StoredModelPickerMetadata = { ...cache, version: MODEL_PICKER_METADATA_CACHE_VERSION };

	if (artificialAnalysisResult) {
		updated.artificialAnalysis = refreshedArtificialAnalysisSource(
			cache.artificialAnalysis,
			artificialAnalysisResult,
			now,
		);
	}
	if (historyResult) {
		updated.historicalArtificialAnalysis = refreshedArtificialAnalysisSource(
			cache.historicalArtificialAnalysis,
			historyResult,
			now,
		);
	}
	if (vercelResult) {
		updated.vercel = vercelResult.complete
			? {
					lastAttemptAt: now,
					lastSuccessAt: now,
					nextRefreshAt: now + VERCEL_MODEL_METADATA_CACHE_TTL_MS,
					data: { releaseDates: [...vercelResult.releaseDates], costs: [...vercelResult.costs] },
				}
			: failedSource(cache.vercel, { releaseDates: [], costs: [] }, now);
	}

	await writeModelPickerMetadataCache(updated);
	return modelPickerMetadataFromStored(modelPickerMetadataCache ?? updated);
}

function getModelLookupKeys(item: ModelMetadataItem): string[] {
	const values = [item.id, item.model.name];
	const keys: string[] = [];
	const seen = new Set<string>();
	const push = (value: string | undefined) => {
		if (!value || seen.has(value)) return;
		seen.add(value);
		keys.push(value);
	};
	for (const value of values) {
		if (!value) continue;
		push(value);
		const slashIndex = value.lastIndexOf("/");
		if (slashIndex >= 0) push(value.slice(slashIndex + 1));
		// Bedrock-style ids: eu.anthropic.claude-... or anthropic.claude-...
		// Keep dotted segments intact (do not split version numbers like 4.5).
		const bedrockMatch =
			/^(?:[a-z]{2}\.)?(?:anthropic|amazon|deepseek|google|meta|mistral|openai)\.([a-z0-9][a-z0-9._-]*?)(?::\d+)?$/iu.exec(
				value,
			);
		if (bedrockMatch) push(bedrockMatch[1]);
		const colonIndex = value.lastIndexOf(":");
		if (colonIndex >= 0) push(value.slice(0, colonIndex));
	}
	// These gateway suffixes select delivery/pricing, not different model weights.
	// Keep fast model families (e.g. Grok Fast) intact outside these known routes.
	if (item.provider === "vercel-ai-gateway") {
		if (/^(?:openai|anthropic|google)\//u.test(item.id)) {
			let servingModel = item.id.replace(/-batch$/u, "");
			if (/^(?:openai|anthropic)\//u.test(servingModel)) servingModel = servingModel.replace(/-fast$/u, "");
			push(servingModel);
			push(servingModel.slice(servingModel.lastIndexOf("/") + 1));
		}
		if (/^(?:moonshotai|minimax)\//u.test(item.id)) {
			const servingModel = item.id.replace(/-highspeed$/u, "");
			push(servingModel.slice(servingModel.lastIndexOf("/") + 1));
		}
	}
	return keys;
}

export function getArtificialAnalysisIq(item: ModelMetadataItem, scores: ArtificialAnalysisScores): number | undefined {
	const keys = getModelLookupKeys(item);
	for (const key of keys) {
		const score = scores.exact.get(normalizeArtificialAnalysisKey(key));
		if (score !== undefined) return score;
	}
	for (const key of keys) {
		for (const variant of expandArtificialAnalysisKeyVariants(key)) {
			const score = scores.canonical.get(variant);
			if (score !== undefined) return score;
		}
	}
	return undefined;
}

/** @internal exported for tests */
export function resolveArtificialAnalysisIqForTest(
	item: { provider: string; id: string; name?: string },
	scores: ArtificialAnalysisScores,
): number | undefined {
	return getArtificialAnalysisIq(
		{
			provider: item.provider,
			id: item.id,
			model: {
				name: item.name ?? item.id,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		},
		scores,
	);
}

export interface ModelPickerMetadata {
	artificialAnalysisScores: ArtificialAnalysisScores;
	/** Published v4.3 launch scores, used only when the current index has no score. */
	historicalArtificialAnalysisScores: ArtificialAnalysisScores;
	vercelReleaseDates: ReadonlyMap<string, string>;
	/** Current Vercel AI Gateway prices, keyed by normalized gateway model id. */
	vercelCosts: ReadonlyMap<string, ModelCost>;
}

export function getModelMetadataCost(item: ModelMetadataItem, vercelCosts: ReadonlyMap<string, ModelCost>): ModelCost {
	if (item.provider !== "vercel-ai-gateway") return item.model.cost;
	return vercelCosts.get(normalizeVercelModelKey(item.id)) ?? item.model.cost;
}

/** Read cached scores synchronously so the picker can render them during a refresh. */
export function getCachedModelPickerMetadata(): ModelPickerMetadata {
	return modelPickerMetadataFromStored(loadModelPickerMetadataCache());
}

/** Return the last successful data, refreshing only sources whose chronological deadline has passed. */
export async function getModelPickerMetadata(): Promise<ModelPickerMetadata> {
	const cache = loadModelPickerMetadataCache();
	if (process.env.DOT_OFFLINE === "1") return modelPickerMetadataFromStored(cache);
	modelPickerMetadataPromise ??= refreshModelPickerMetadata(cache, Date.now()).finally(() => {
		modelPickerMetadataPromise = undefined;
	});
	return modelPickerMetadataPromise;
}

/** Start metadata refresh without delaying interactive startup. */
export function warmModelPickerMetadata(): void {
	void getModelPickerMetadata();
}
