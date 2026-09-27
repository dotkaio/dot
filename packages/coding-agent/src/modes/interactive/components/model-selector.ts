import { join } from "node:path";
import { type Model, modelsAreEqual } from "@dotkaio/dot-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	type MouseWheelDirection,
	Spacer,
	Text,
	type TUI,
} from "@dotkaio/dot-tui";
import { getAgentDir } from "../../../config.ts";
import { FileAuthStorageBackend } from "../../../core/auth-storage.ts";
import type { ModelRuntime } from "../../../core/model-runtime.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";
import { getModelSelectorSearchText } from "../model-search.ts";
import { highlightSelectedListItem, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

type ModelScope = "all" | "scoped";
type ModelSortDirection = "ascending" | "descending";
type ModelSortMode = "default" | "model" | "context" | "input" | "output" | "provider" | "iq" | "releaseDate";

const MODEL_SORT_MODES: ModelSortMode[] = [
	"default",
	"model",
	"context",
	"input",
	"output",
	"provider",
	"iq",
	"releaseDate",
];

const MODEL_SORT_DEFAULT_DIRECTIONS: Readonly<Record<Exclude<ModelSortMode, "default">, ModelSortDirection>> = {
	model: "ascending",
	context: "descending",
	input: "ascending",
	output: "ascending",
	provider: "ascending",
	iq: "descending",
	releaseDate: "descending",
};

const MODEL_SORT_LABELS: Record<ModelSortMode, string> = {
	default: "default",
	model: "model",
	context: "context",
	input: "input",
	output: "output",
	provider: "provider",
	iq: "IQ",
	releaseDate: "released",
};

interface VercelGatewayModelMetadata {
	id?: unknown;
	name?: unknown;
	released?: unknown;
	owned_by?: unknown;
}

export interface ArtificialAnalysisScores {
	exact: ReadonlyMap<string, number>;
	canonical: ReadonlyMap<string, number>;
}

export interface ArtificialAnalysisDataManifest {
	path: string;
	key: string;
}

interface ArtificialAnalysisCacheEntry {
	fetchedAt: number;
	scores: ArtificialAnalysisScores;
}

interface ArtificialAnalysisFetchResult {
	complete: boolean;
	scores: ArtificialAnalysisScores;
}

interface StoredArtificialAnalysisScores {
	version: number;
	fetchedAt: number;
	exact: Array<[string, number]>;
	canonical: Array<[string, number]>;
}

interface HttpResponse {
	ok: boolean;
	arrayBuffer(): Promise<ArrayBuffer>;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

const VERCEL_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const ARTIFICIAL_ANALYSIS_INTELLIGENCE_URL = "https://artificialanalysis.ai/#intelligence";
const ARTIFICIAL_ANALYSIS_CACHE_FILE = "model-iq-cache.json";
const ARTIFICIAL_ANALYSIS_CACHE_VERSION = 1;
export const ARTIFICIAL_ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let vercelReleaseDatesPromise: Promise<Map<string, string>> | undefined;
let artificialAnalysisCacheEntry: ArtificialAnalysisCacheEntry | undefined;
let artificialAnalysisScoresPromise: Promise<ArtificialAnalysisScores> | undefined;

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

const MODEL_COLUMN_WIDTH = 30;
const CONTEXT_COLUMN_WIDTH = 8;
const PRICE_COLUMN_WIDTH = 9;
const PROVIDER_COLUMN_WIDTH = 15;
const IQ_COLUMN_WIDTH = 6;
const RELEASE_DATE_COLUMN_WIDTH = 12;

function normalizeMaxVisible(maxVisible: number | undefined, fallback: number): number {
	if (maxVisible === undefined || maxVisible <= 0 || !Number.isFinite(maxVisible)) return fallback;
	return Math.max(1, Math.floor(maxVisible));
}

function truncateCell(value: string, width: number): string {
	if (value.length <= width) return value.padEnd(width);
	if (width <= 1) return value.slice(0, width);
	return `${value.slice(0, width - 1)}…`;
}

function formatTokenCount(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "-";
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
	}
	return count.toString();
}

function formatPrice(price: number): string {
	if (!Number.isFinite(price)) return "-";
	if (price === 0) return "$0/M";
	const digits = price < 0.01 ? 4 : price < 1 ? 3 : 2;
	return `$${price.toFixed(digits).replace(/\.0+$|(?<=\.\d*[1-9])0+$/u, "")}/M`;
}

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
	return (await fetch(url)) as unknown as HttpResponse;
}

async function getVercelReleaseDates(): Promise<Map<string, string>> {
	if (process.env.DOT_OFFLINE === "1") return new Map<string, string>();
	vercelReleaseDatesPromise ??= fetchHttp(VERCEL_MODELS_URL)
		.then(async (response) => {
			if (!response.ok) return new Map<string, string>();
			const data = (await response.json()) as { data?: unknown };
			const items = Array.isArray(data.data) ? data.data : [];
			const dates = new Map<string, string>();

			for (const rawItem of items) {
				const item = rawItem as VercelGatewayModelMetadata;
				if (typeof item.id !== "string") continue;

				const date = formatDateValue(item.released);
				if (!date) continue;

				addVercelReleaseDateKey(dates, item.id, date);
				const slashIndex = item.id.indexOf("/");
				if (slashIndex >= 0) {
					addVercelReleaseDateKey(dates, item.id.slice(slashIndex + 1), date);
				}
				if (typeof item.name === "string") {
					addVercelReleaseDateKey(dates, item.name, date);
				}
				if (typeof item.owned_by === "string" && slashIndex >= 0) {
					addVercelReleaseDateKey(dates, `${item.owned_by}/${item.id.slice(slashIndex + 1)}`, date);
				}
			}

			return dates;
		})
		.catch(() => new Map<string, string>());
	return vercelReleaseDatesPromise;
}

function getReleaseDate(item: ModelItem, vercelReleaseDates: ReadonlyMap<string, string>): string {
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

function emptyArtificialAnalysisScores(): ArtificialAnalysisScores {
	return { exact: new Map<string, number>(), canonical: new Map<string, number>() };
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
			!Number.isFinite(entry[1])
		) {
			return undefined;
		}
		scores.set(entry[0], entry[1]);
	}
	return scores;
}

function parseArtificialAnalysisCache(content: string | undefined): ArtificialAnalysisCacheEntry | undefined {
	if (!content) return undefined;
	try {
		const value = JSON.parse(content) as unknown;
		if (value === null || typeof value !== "object") return undefined;
		const record = value as Record<string, unknown>;
		if (
			record.version !== ARTIFICIAL_ANALYSIS_CACHE_VERSION ||
			typeof record.fetchedAt !== "number" ||
			!Number.isFinite(record.fetchedAt)
		) {
			return undefined;
		}
		const exact = parseStoredScoreEntries(record.exact);
		const canonical = parseStoredScoreEntries(record.canonical);
		if (!exact || !canonical) return undefined;
		return { fetchedAt: record.fetchedAt, scores: { exact, canonical } };
	} catch {
		return undefined;
	}
}

export function isArtificialAnalysisCacheFresh(fetchedAt: number, now: number = Date.now()): boolean {
	const age = now - fetchedAt;
	return Number.isFinite(fetchedAt) && age >= 0 && age < ARTIFICIAL_ANALYSIS_CACHE_TTL_MS;
}

function getArtificialAnalysisCacheStorage(): FileAuthStorageBackend {
	return new FileAuthStorageBackend(join(getAgentDir(), ARTIFICIAL_ANALYSIS_CACHE_FILE));
}

function readArtificialAnalysisCache(): ArtificialAnalysisCacheEntry | undefined {
	try {
		return getArtificialAnalysisCacheStorage().withLock((content) => ({
			result: parseArtificialAnalysisCache(content),
		}));
	} catch {
		return undefined;
	}
}

async function writeArtificialAnalysisCache(entry: ArtificialAnalysisCacheEntry): Promise<void> {
	const stored: StoredArtificialAnalysisScores = {
		version: ARTIFICIAL_ANALYSIS_CACHE_VERSION,
		fetchedAt: entry.fetchedAt,
		exact: [...entry.scores.exact],
		canonical: [...entry.scores.canonical],
	};
	try {
		await getArtificialAnalysisCacheStorage().withLockAsync(async () => ({
			result: undefined,
			next: JSON.stringify(stored, null, 2),
		}));
	} catch {
		// IQ metadata remains usable in memory when the cache is not writable.
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
			/-(?:adaptive-reasoning|max-effort|non-reasoning|highthinking|nothinking|max|xhigh|high|medium|minimal|low|thinking|base|preview|latest|instruct|chat|highspeed|lightning|fast|instant|free)(?=-|$)/gu,
			"",
		);
	} while (key !== previous);
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

	// Fallback only when a specific product tier is not ranked separately on AA
	// (e.g. o3-pro -> o3, gpt-5.5-pro -> gpt-5.5, glm-5.2-fast already stripped above).
	if (base.endsWith("-pro")) {
		variants.add(base.slice(0, -"-pro".length));
	}
	variants.add(base.replace(/-effort$/u, ""));

	// Zero-padded version orthography (identity-only; not cross-version).
	for (const variant of [...variants]) {
		for (const zeroPadVariant of expandZeroPaddedVersionVariants(variant)) {
			variants.add(zeroPadVariant);
		}
	}

	return [...variants].filter(Boolean);
}

function setBestScore(scores: Map<string, number>, key: string, score: number): void {
	if (!key) return;
	const existing = scores.get(key);
	if (existing === undefined || score > existing) {
		scores.set(key, score);
	}
}

function collectArtificialAnalysisScoresFromValue(
	value: unknown,
	exact: Map<string, number>,
	canonical: Map<string, number>,
): void {
	if (value === null || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectArtificialAnalysisScoresFromValue(item, exact, canonical);
		}
		return;
	}

	const record = value as Record<string, unknown>;
	const score =
		parseArtificialAnalysisScore(record.intelligenceIndex) ??
		parseArtificialAnalysisScore(record.artificialAnalysisIntelligenceIndex);
	const detailsUrl = typeof record.detailsUrl === "string" ? detailsUrlToModelSlug(record.detailsUrl) : undefined;
	const hasModelIdentity =
		typeof record.id === "string" ||
		typeof record.slug === "string" ||
		typeof record.name === "string" ||
		typeof record.shortName === "string" ||
		typeof record.label === "string" ||
		typeof detailsUrl === "string";
	if (score !== undefined && hasModelIdentity) {
		for (const key of [record.name, record.shortName, record.slug, record.id, record.label, detailsUrl]) {
			if (typeof key !== "string" || !key) continue;
			setBestScore(exact, normalizeArtificialAnalysisKey(key), score);
			setBestScore(canonical, canonicalizeArtificialAnalysisKey(key), score);
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
			payloads.push(...parseArtificialAnalysisFlightPayloads(parsedPayload));
		} else if (parsedPayload !== null && typeof parsedPayload === "object") {
			payloads.push(parsedPayload);
		}
	}

	return [
		...payloads,
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

function detailsUrlToModelSlug(value: string): string | undefined {
	const match = /\/models\/([^/?#]+)/u.exec(value);
	return match?.[1];
}

function parseArtificialAnalysisScore(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") {
		const score = Number(value);
		return Number.isFinite(score) ? score : undefined;
	}
	return undefined;
}

export function parseArtificialAnalysisScores(html: string): ArtificialAnalysisScores {
	const exact = new Map<string, number>();
	const canonical = new Map<string, number>();

	// The IQ column is the Intelligence Index from the Artificial Analysis #intelligence leaderboard.
	for (const payload of parseArtificialAnalysisPayloadScoreData(html)) {
		collectArtificialAnalysisScoresFromValue(payload, exact, canonical);
	}

	return { exact, canonical };
}

async function fetchArtificialAnalysisManifest(manifest: ArtificialAnalysisDataManifest): Promise<unknown> {
	const url = new URL(manifest.path, ARTIFICIAL_ANALYSIS_INTELLIGENCE_URL).href;
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
		if (manifests.length === 0) return { complete: false, scores: pageScores };

		try {
			const payloads = await Promise.all(manifests.map(fetchArtificialAnalysisManifest));
			const exact = new Map(pageScores.exact);
			const canonical = new Map(pageScores.canonical);
			for (const payload of payloads) {
				collectArtificialAnalysisScoresFromValue(payload, exact, canonical);
			}
			return { complete: true, scores: { exact, canonical } };
		} catch {
			return { complete: false, scores: pageScores };
		}
	} catch {
		return { complete: false, scores: emptyArtificialAnalysisScores() };
	}
}

async function refreshArtificialAnalysisScores(
	cached: ArtificialAnalysisCacheEntry | undefined,
): Promise<ArtificialAnalysisScores> {
	const result = await fetchArtificialAnalysisScores(ARTIFICIAL_ANALYSIS_INTELLIGENCE_URL);
	if (!result.complete || result.scores.exact.size === 0) {
		return cached?.scores ?? result.scores;
	}

	const entry = { fetchedAt: Date.now(), scores: result.scores };
	artificialAnalysisCacheEntry = entry;
	await writeArtificialAnalysisCache(entry);
	return entry.scores;
}

async function getArtificialAnalysisScores(): Promise<ArtificialAnalysisScores> {
	if (process.env.DOT_OFFLINE === "1") return emptyArtificialAnalysisScores();
	const now = Date.now();
	let cached = artificialAnalysisCacheEntry;
	if (!cached || !isArtificialAnalysisCacheFresh(cached.fetchedAt, now)) {
		const stored = readArtificialAnalysisCache();
		if (stored && (!cached || stored.fetchedAt > cached.fetchedAt)) cached = stored;
		artificialAnalysisCacheEntry = cached;
	}
	if (cached && isArtificialAnalysisCacheFresh(cached.fetchedAt, now)) return cached.scores;

	artificialAnalysisScoresPromise ??= refreshArtificialAnalysisScores(cached).finally(() => {
		artificialAnalysisScoresPromise = undefined;
	});
	return artificialAnalysisScoresPromise;
}

function getModelLookupKeys(item: ModelItem): string[] {
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
	return keys;
}

function getArtificialAnalysisIq(item: ModelItem, scores: ArtificialAnalysisScores): number | undefined {
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
				id: item.id,
				name: item.name ?? item.id,
				api: "openai-completions",
				provider: item.provider,
				baseUrl: "",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 0,
				maxTokens: 0,
			},
		},
		scores,
	);
}

function formatArtificialAnalysisIq(item: ModelItem, scores: ArtificialAnalysisScores): string {
	const score = getArtificialAnalysisIq(item, scores);
	return score === undefined ? "-" : Math.round(score).toString();
}

function formatModelTableRow(
	item: ModelItem,
	vercelReleaseDates: ReadonlyMap<string, string>,
	artificialAnalysisScores: ArtificialAnalysisScores,
): string {
	const modelName = item.model.name || item.id;
	return [
		truncateCell(modelName, MODEL_COLUMN_WIDTH),
		formatTokenCount(item.model.contextWindow).padStart(CONTEXT_COLUMN_WIDTH),
		formatPrice(item.model.cost.input).padStart(PRICE_COLUMN_WIDTH),
		formatPrice(item.model.cost.output).padStart(PRICE_COLUMN_WIDTH),
		truncateCell(item.provider, PROVIDER_COLUMN_WIDTH),
		formatArtificialAnalysisIq(item, artificialAnalysisScores).padStart(IQ_COLUMN_WIDTH),
		getReleaseDate(item, vercelReleaseDates).padEnd(RELEASE_DATE_COLUMN_WIDTH),
	].join("  ");
}

function getSortIndicator(sortMode: ModelSortMode, column: ModelSortMode, direction: ModelSortDirection): string {
	if (sortMode !== column) return "";
	return direction === "ascending" ? " ↑" : " ↓";
}

function formatModelTableHeader(sortMode: ModelSortMode, direction: ModelSortDirection): string {
	return [
		`Model${getSortIndicator(sortMode, "model", direction)}`.padEnd(MODEL_COLUMN_WIDTH),
		`Context${getSortIndicator(sortMode, "context", direction)}`.padStart(CONTEXT_COLUMN_WIDTH),
		`Input${getSortIndicator(sortMode, "input", direction)}`.padStart(PRICE_COLUMN_WIDTH),
		`Output${getSortIndicator(sortMode, "output", direction)}`.padStart(PRICE_COLUMN_WIDTH),
		`Provider${getSortIndicator(sortMode, "provider", direction)}`.padEnd(PROVIDER_COLUMN_WIDTH),
		`IQ${getSortIndicator(sortMode, "iq", direction)}`.padStart(IQ_COLUMN_WIDTH),
		`Released${getSortIndicator(sortMode, "releaseDate", direction)}`.padEnd(RELEASE_DATE_COLUMN_WIDTH),
	].join("  ");
}

function compareText(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareModelIdentity(a: ModelItem, b: ModelItem): number {
	return (
		compareText(a.provider, b.provider) ||
		compareText(a.model.name || a.id, b.model.name || b.id) ||
		compareText(a.id, b.id)
	);
}

function compareFiniteNumber(a: number, b: number, direction: "ascending" | "descending"): number {
	const aFinite = Number.isFinite(a);
	const bFinite = Number.isFinite(b);
	if (aFinite && !bFinite) return -1;
	if (!aFinite && bFinite) return 1;
	if (!aFinite && !bFinite) return 0;
	return direction === "ascending" ? a - b : b - a;
}

function getReleaseDateSortValue(item: ModelItem, vercelReleaseDates: ReadonlyMap<string, string>): number {
	const date = getReleaseDate(item, vercelReleaseDates);
	const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(date);
	if (!match) return Number.NEGATIVE_INFINITY;
	return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private settingsManager: SettingsManager;
	private modelRuntime: ModelRuntime;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private refreshStatusMessage = "Refreshing model catalogs…";
	private refreshStatusSuccess = false;
	private tui: TUI;
	private vercelReleaseDates: ReadonlyMap<string, string> = new Map();
	private artificialAnalysisScores: ArtificialAnalysisScores = emptyArtificialAnalysisScores();
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";
	private sortMode: ModelSortMode = "default";
	private sortDirection: ModelSortDirection = "ascending";
	private scopeText?: Text;
	private scopeHintText?: Text;
	private sortHintText?: Text;
	private maxVisible = 10;
	private readonly refreshAbortController = new AbortController();
	private refreshTimeout?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		settingsManager: SettingsManager,
		modelRuntime: ModelRuntime,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		maxVisible?: number,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.settingsManager = settingsManager;
		this.modelRuntime = modelRuntime;
		this.scopedModels = scopedModels;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.maxVisible = normalizeMaxVisible(maxVisible, 10);

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add hint about model filtering
		if (scopedModels.length > 0) {
			this.scopeText = new Text(this.getScopeText(), 0, 0);
			this.addChild(this.scopeText);
			this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
			this.addChild(this.scopeHintText);
		} else {
			const hintText = "Only showing models from configured providers. Use /login to add providers.";
			this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		}
		this.sortHintText = new Text(this.getSortHintText(), 0, 0);
		this.addChild(this.sortHintText);
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the first filtered item
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Render the current snapshot immediately, then refresh catalogs + remote metadata in the background.
		this.loadModelsFromSnapshot();
		if (initialSearchInput) this.filterModels(initialSearchInput);
		else this.updateList();
		this.tui.requestRender();
		void this.refreshModels();
		void this.loadRemoteModelMetadata();
	}

	private loadModelsFromSnapshot(): void {
		const models = this.modelRuntime.getAvailableSnapshot().map((model: Model<any>) => ({
			provider: model.provider,
			id: model.id,
			model,
		}));
		this.allModels = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		this.scopedModelItems = this.scopedModels.map((scoped) => ({
			provider: scoped.model.provider,
			id: scoped.model.id,
			model: scoped.model,
		}));
		const initialQuery = this.searchInput.getValue();
		this.refreshFilteredModels(initialQuery ? undefined : this.currentModel, initialQuery, {
			resetSelection: initialQuery.length > 0,
		});
	}

	private async loadRemoteModelMetadata(): Promise<void> {
		const [vercelReleaseDates, artificialAnalysisScores] = await Promise.all([
			getVercelReleaseDates(),
			getArtificialAnalysisScores(),
		]);
		if (this.closed) return;
		this.vercelReleaseDates = vercelReleaseDates;
		this.artificialAnalysisScores = artificialAnalysisScores;
		this.refreshFilteredModels(this.filteredModels[this.selectedIndex]?.model, this.searchInput.getValue());
		this.tui.requestRender();
	}

	private async refreshModels(): Promise<void> {
		const timeoutMs = 15_000;
		let timedOut = false;
		this.refreshTimeout = setTimeout(() => {
			timedOut = true;
			this.refreshAbortController.abort();
		}, timeoutMs);
		try {
			const result = await this.modelRuntime.refresh({ signal: this.refreshAbortController.signal });
			if (this.closed) return;
			this.refreshStatusMessage = "";
			if (result.aborted && timedOut) {
				this.errorMessage = "Model refresh timed out; showing cached models.";
			} else if (result.errors.size === 1) {
				this.errorMessage = `Could not refresh ${result.errors.keys().next().value}; showing cached models.`;
			} else if (result.errors.size > 1) {
				this.errorMessage = `Could not refresh ${result.errors.size} model catalogs; showing cached models.`;
			} else {
				this.errorMessage = this.modelRuntime.getError();
				if (!this.errorMessage) {
					this.refreshStatusMessage = "Model catalogs refreshed.";
					this.refreshStatusSuccess = true;
				}
			}
			this.loadModelsFromSnapshot();
			this.filterModels(this.searchInput.getValue());
			this.tui.requestRender();
		} finally {
			if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		}
	}

	private close(): void {
		this.closed = true;
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		this.refreshAbortController.abort();
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		// Sort: current model first, then by provider
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});
		return sorted;
	}

	private sortModelsForMode(models: ModelItem[]): ModelItem[] {
		if (this.sortMode === "default") return [...models];

		const sorted = [...models];
		sorted.sort((a, b) => {
			let result = 0;
			const textDirection = this.sortDirection === "ascending" ? 1 : -1;
			switch (this.sortMode) {
				case "model":
					result = compareText(a.model.name || a.id, b.model.name || b.id) * textDirection;
					break;
				case "context":
					result = compareFiniteNumber(a.model.contextWindow, b.model.contextWindow, this.sortDirection);
					break;
				case "input":
					result = compareFiniteNumber(a.model.cost.input, b.model.cost.input, this.sortDirection);
					break;
				case "output":
					result = compareFiniteNumber(a.model.cost.output, b.model.cost.output, this.sortDirection);
					break;
				case "provider":
					result = compareText(a.provider, b.provider) * textDirection;
					break;
				case "iq":
					result = compareFiniteNumber(
						getArtificialAnalysisIq(a, this.artificialAnalysisScores) ?? Number.NEGATIVE_INFINITY,
						getArtificialAnalysisIq(b, this.artificialAnalysisScores) ?? Number.NEGATIVE_INFINITY,
						this.sortDirection,
					);
					break;
				case "releaseDate":
					result = compareFiniteNumber(
						getReleaseDateSortValue(a, this.vercelReleaseDates),
						getReleaseDateSortValue(b, this.vercelReleaseDates),
						this.sortDirection,
					);
					break;
				case "default":
					break;
			}
			return result || compareModelIdentity(a, b);
		});
		return sorted;
	}

	private getScopeText(): string {
		const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
		const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
	}

	private getScopeHintText(): string {
		return keyHint("tui.input.tab", "scope") + theme.fg("muted", " (all/scoped)");
	}

	private getSortHintText(): string {
		const directionHint = this.sortMode === "default" ? "" : ` ${this.sortDirection === "ascending" ? "↑" : "↓"}`;
		return `${keyHint("app.model.sort", "sort")} ${theme.fg("muted", `(${MODEL_SORT_LABELS[this.sortMode]}${directionHint})`)}`;
	}

	private getBaseModels(): ModelItem[] {
		return this.scope === "scoped" ? this.scopedModelItems : this.allModels;
	}

	private refreshFilteredModels(
		selectedModel: Model<any> | undefined,
		query: string,
		options: { resetSelection?: boolean } = {},
	): void {
		this.activeModels = this.sortModelsForMode(this.getBaseModels());
		const fuzzyMatches = query
			? fuzzyFilter(this.activeModels, query, ({ id, provider, model }) =>
					getModelSelectorSearchText({ id, provider, name: model.name }),
				)
			: this.activeModels;
		this.filteredModels = this.sortMode === "default" ? fuzzyMatches : this.sortModelsForMode(fuzzyMatches);

		if (options.resetSelection) {
			this.selectedIndex = 0;
		} else {
			const selectedIndex = selectedModel
				? this.filteredModels.findIndex((item) => modelsAreEqual(selectedModel, item.model))
				: -1;
			this.selectedIndex =
				selectedIndex >= 0
					? selectedIndex
					: Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		}
		this.updateList();
	}

	private setSortMode(sortMode: ModelSortMode): void {
		if (sortMode === "default") {
			this.sortMode = "default";
		} else if (this.sortMode === sortMode) {
			this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
		} else {
			this.sortMode = sortMode;
			this.sortDirection = MODEL_SORT_DEFAULT_DIRECTIONS[sortMode];
		}

		this.refreshFilteredModels(undefined, this.searchInput.getValue(), { resetSelection: true });
		if (this.sortHintText) {
			this.sortHintText.setText(this.getSortHintText());
		}
	}

	private cycleSortMode(): void {
		const currentIndex = MODEL_SORT_MODES.indexOf(this.sortMode);
		const nextMode = MODEL_SORT_MODES[(currentIndex + 1) % MODEL_SORT_MODES.length] ?? "default";
		this.setSortMode(nextMode);
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		const selectedModel = this.filteredModels[this.selectedIndex]?.model ?? this.currentModel;
		this.scope = scope;
		this.selectedIndex = 0;
		this.refreshFilteredModels(selectedModel, this.searchInput.getValue());
		if (this.scopeText) {
			this.scopeText.setText(this.getScopeText());
		}
	}

	private filterModels(query: string): void {
		this.filteredModels = query
			? fuzzyFilter(this.activeModels, query, ({ id, provider, model }) =>
					getModelSelectorSearchText({ id, provider, name: model.name }),
				)
			: this.activeModels;
		// When filtering by a query, move the selector to the top row so the best
		// match is highlighted. When the query is cleared, keep the current position
		// clamped to the (restored) list length.
		this.selectedIndex = query ? 0 : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredModels.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredModels.length);

		if (this.filteredModels.length > 0) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  ${formatModelTableHeader(this.sortMode, this.sortDirection)}`), 0, 0),
			);
		}

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const prefix = "  ";
			const line = `${prefix}${formatModelTableRow(item, this.vercelReleaseDates, this.artificialAnalysisScores)}`;
			const styledLine = isSelected ? highlightSelectedListItem(line) : line;

			this.listContainer.addChild(new Text(styledLine, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.errorMessage) {
			// Show error in red
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  ${selected.provider}/${selected.id} · ${selected.model.name}`), 0, 0),
			);
		}
		if (this.refreshStatusMessage) {
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(theme.fg(this.refreshStatusSuccess ? "success" : "muted", `  ${this.refreshStatusMessage}`), 0, 0),
			);
		}
	}

	handleMouseWheel(direction: MouseWheelDirection, lines: number): boolean {
		if (this.filteredModels.length === 0) return true;
		const delta = direction === "up" ? -lines : lines;
		this.selectedIndex = Math.max(0, Math.min(this.filteredModels.length - 1, this.selectedIndex + delta));
		this.updateList();
		return true;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			if (this.scopedModelItems.length > 0) {
				const nextScope: ModelScope = this.scope === "all" ? "scoped" : "all";
				this.setScope(nextScope);
				if (this.scopeHintText) {
					this.scopeHintText.setText(this.getScopeHintText());
				}
			}
			return;
		}
		if (kb.matches(keyData, "app.model.sortByModel")) {
			this.setSortMode("model");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByContext")) {
			this.setSortMode("context");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByInput")) {
			this.setSortMode("input");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByOutput")) {
			this.setSortMode("output");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByProvider")) {
			this.setSortMode("provider");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByIq")) {
			this.setSortMode("iq");
			return;
		}
		if (kb.matches(keyData, "app.model.sortByReleaseDate")) {
			this.setSortMode("releaseDate");
			return;
		}
		if (kb.matches(keyData, "app.model.sort")) {
			this.cycleSortMode();
			return;
		}
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.handleSelect(selectedModel.model);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "tui.select.cancel")) {
			this.close();
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		this.close();
		// Save as new default
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
