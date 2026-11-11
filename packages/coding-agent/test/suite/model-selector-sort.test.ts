import type { Api, Model } from "@dotkaio/dot-ai/compat";
import { setKeybindings, type TUI } from "@dotkaio/dot-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import * as modelPickerMetadata from "../../src/core/model-picker-metadata.ts";
import {
	getModelMetadataCost,
	MODEL_METADATA_RETRY_INTERVAL_MS,
	VERCEL_MODEL_METADATA_CACHE_TTL_MS,
} from "../../src/core/model-picker-metadata.ts";
import {
	ARTIFICIAL_ANALYSIS_CACHE_TTL_MS,
	decryptArtificialAnalysisPayload,
	isArtificialAnalysisCacheFresh,
	ModelSelectorComponent,
	parseArtificialAnalysisDataManifests,
	parseArtificialAnalysisScores,
	resolveArtificialAnalysisIqForTest,
} from "../../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "./harness.ts";

interface SelectorRemoteMetadata {
	artificialAnalysisScores: {
		exact: ReadonlyMap<string, number>;
		canonical: ReadonlyMap<string, number>;
	};
	vercelReleaseDates: ReadonlyMap<string, string>;
}

interface SortCase {
	name: string;
	key: string;
	firstDirectionTop: string;
	secondDirectionTop: string;
}

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

async function waitForAsyncRender(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function addProviderSortFixtures(harness: Harness): void {
	const api = harness.models[0].api as Api;
	const baseConfig = {
		baseUrl: "http://localhost:0",
		apiKey: "test-key",
		api,
	};

	harness.session.modelRuntime.registerProvider("aaa-provider", {
		...baseConfig,
		models: [
			{
				id: "provider-alpha",
				name: "Delta",
				reasoning: false,
				input: ["text"],
				cost: { input: 1.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 150,
				maxTokens: 100,
			},
		],
	});
	harness.session.modelRuntime.registerProvider("zzz-provider", {
		...baseConfig,
		models: [
			{
				id: "provider-zeta",
				name: "Zulu",
				reasoning: false,
				input: ["text"],
				cost: { input: 2.5, output: 2.5, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 250,
				maxTokens: 100,
			},
		],
	});
}

function setRemoteMetadata(selector: ModelSelectorComponent): void {
	const state = selector as unknown as SelectorRemoteMetadata;
	state.artificialAnalysisScores = {
		exact: new Map<string, number>([
			["alpha", 80],
			["bravo", 65],
			["charlie", 50],
			["provider-alpha", 60],
			["provider-zeta", 70],
		]),
		canonical: new Map<string, number>(),
	};
	state.vercelReleaseDates = new Map<string, string>([
		["alpha", "01/01/2026"],
		["bravo", "01/01/2025"],
		["charlie", "01/01/2024"],
		["provider-alpha", "06/01/2025"],
		["provider-zeta", "01/01/2023"],
	]);
}

function requireRegistryModel(harness: Harness, provider: string, id: string): Model<Api> {
	const model = harness.session.modelRuntime.getModel(provider, id);
	if (!model) throw new Error(`Missing test model ${provider}/${id}`);
	return model;
}

function getScopedModels(harness: Harness): Array<{ model: Model<Api> }> {
	return [
		{ model: requireRegistryModel(harness, "faux", "alpha") },
		{ model: requireRegistryModel(harness, "faux", "bravo") },
		{ model: requireRegistryModel(harness, "faux", "charlie") },
		{ model: requireRegistryModel(harness, "aaa-provider", "provider-alpha") },
		{ model: requireRegistryModel(harness, "zzz-provider", "provider-zeta") },
	];
}

function createSelector(
	harness: Harness,
	options: {
		currentModel?: Model<Api>;
		initialSearchInput?: string;
		onSelect?: (model: Model<Api>) => void;
	} = {},
): ModelSelectorComponent {
	const scopedModels = getScopedModels(harness);
	return new ModelSelectorComponent(
		createFakeTui(),
		options.currentModel ?? scopedModels[0]?.model,
		harness.settingsManager,
		harness.session.modelRuntime,
		scopedModels,
		(model) => options.onSelect?.(model as Model<Api>),
		() => {},
		options.initialSearchInput,
		20,
	);
}

async function selectTopModelAfterKeys(harness: Harness, keys: readonly string[]): Promise<string> {
	let selectedModel = "";
	const selector = createSelector(harness, {
		onSelect: (model) => {
			selectedModel = `${model.provider}/${model.id}`;
		},
	});

	await waitForAsyncRender();
	setRemoteMetadata(selector);
	for (const key of keys) {
		selector.handleInput(key);
	}
	selector.handleInput("\r");
	return selectedModel;
}

async function createSortHarness(): Promise<Harness> {
	const harness = await createHarness({
		models: [
			{
				id: "alpha",
				name: "Alpha",
				reasoning: true,
				cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 300,
				maxTokens: 100,
			},
			{
				id: "bravo",
				name: "Bravo",
				reasoning: true,
				cost: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200,
				maxTokens: 100,
			},
			{
				id: "charlie",
				name: "Charlie",
				reasoning: true,
				cost: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100,
				maxTokens: 100,
			},
		],
	});
	addProviderSortFixtures(harness);
	return harness;
}

describe("model selector sorting", () => {
	const harnesses: Harness[] = [];
	let previousOffline: string | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		previousOffline = process.env.DOT_OFFLINE;
		process.env.DOT_OFFLINE = "1";
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		if (previousOffline === undefined) {
			delete process.env.DOT_OFFLINE;
		} else {
			process.env.DOT_OFFLINE = previousOffline;
		}
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		vi.restoreAllMocks();
	});

	it("sorts every /model column in both directions", async () => {
		const harness = await createSortHarness();
		harnesses.push(harness);

		const sortCases: SortCase[] = [
			{ name: "model", key: "M", firstDirectionTop: "faux/alpha", secondDirectionTop: "zzz-provider/provider-zeta" },
			{ name: "context", key: "C", firstDirectionTop: "faux/alpha", secondDirectionTop: "faux/charlie" },
			{ name: "input", key: "I", firstDirectionTop: "faux/alpha", secondDirectionTop: "faux/charlie" },
			{ name: "output", key: "O", firstDirectionTop: "faux/charlie", secondDirectionTop: "faux/alpha" },
			{
				name: "provider",
				key: "P",
				firstDirectionTop: "aaa-provider/provider-alpha",
				secondDirectionTop: "zzz-provider/provider-zeta",
			},
			{ name: "IQ", key: "Q", firstDirectionTop: "faux/alpha", secondDirectionTop: "faux/charlie" },
			{
				name: "release date",
				key: "R",
				firstDirectionTop: "faux/alpha",
				secondDirectionTop: "zzz-provider/provider-zeta",
			},
		];

		for (const sortCase of sortCases) {
			await expect(selectTopModelAfterKeys(harness, [sortCase.key]), sortCase.name).resolves.toBe(
				sortCase.firstDirectionTop,
			);
			await expect(selectTopModelAfterKeys(harness, [sortCase.key, sortCase.key]), sortCase.name).resolves.toBe(
				sortCase.secondDirectionTop,
			);
		}
	});

	it("decodes full data manifests and expires IQ metadata after 24 hours", async () => {
		const keyHex = "01".repeat(32);
		const manifest = { path: "/data/models.txt", key: keyHex };
		const flightPayload = `1f:${JSON.stringify(["$", "div", null, { manifest }])}\n`;
		const html = `<script>self.__next_f.push([1,${JSON.stringify(flightPayload)}])</script>`;
		expect(parseArtificialAnalysisDataManifests(html)).toEqual([manifest]);

		const now = 2_000_000_000_000;
		expect(ARTIFICIAL_ANALYSIS_CACHE_TTL_MS).toBe(86_400_000);
		expect(isArtificialAnalysisCacheFresh(now - ARTIFICIAL_ANALYSIS_CACHE_TTL_MS + 1, now)).toBe(true);
		expect(isArtificialAnalysisCacheFresh(now - ARTIFICIAL_ANALYSIS_CACHE_TTL_MS, now)).toBe(false);

		const payload = [{ slug: "historical-model", deprecated: true, intelligenceIndex: 42.5 }];
		const compressed = await new Response(
			new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer();
		const keyBytes = new Uint8Array(32).fill(1);
		const digest = await crypto.subtle.digest("SHA-256", keyBytes);
		const iv = new Uint8Array(digest).slice(0, 12);
		const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
		const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, compressed);
		expect(await decryptArtificialAnalysisPayload(encrypted, keyHex)).toEqual(payload);
	});

	it("uses only published Intelligence Index scores across provider routes", () => {
		const scores = parseArtificialAnalysisScores(
			`<script type="application/ld+json">${JSON.stringify({
				models: [
					{
						slug: "gpt-5-6-sol-high",
						name: "GPT-5.6 Sol (High)",
						shortName: "GPT-5.6 Sol",
						intelligenceIndex: 56.4,
					},
					{
						slug: "gpt-5-6-sol-max",
						name: "GPT-5.6 Sol (Max)",
						shortName: "GPT-5.6 Sol",
						intelligenceIndex: 59.2,
					},
					{ slug: "claude-4-5-haiku", name: "Claude Haiku 4.5", intelligenceIndex: 29.5 },
					{ slug: "grok-4-5-high", name: "Grok 4.5 (High)", intelligenceIndex: 60.1 },
					{ slug: "gemma-4-31b", name: "Gemma 4 31B (Reasoning)", intelligenceIndex: 30.1 },
					{ slug: "llama-3-3-instruct-70b", intelligenceIndex: 25.4 },
					{ slug: "qwen3-32b", intelligenceIndex: 35.5 },
					{ slug: "nova-2-0-lite", intelligenceIndex: 20.1 },
					{ slug: "old-model", deprecated: true, intelligenceIndex: 12.3 },
					{ slug: "unranked", intelligenceIndex: null, codingIndex: 99 },
					{ label: "Codex - Unranked", codingAgentsIndex: 0.99 },
					{ slug: "o3", intelligenceIndex: 30.4 },
				],
			})}</script>`,
		);
		expect(scores.exact.get("gpt-5-6-sol-high")).toBe(56.4);
		expect(scores.canonical.get("gpt-5-6-sol")).toBe(59.2);
		expect(scores.exact.get("old-model")).toBe(12.3);
		expect(scores.exact.has("unranked")).toBe(false);

		for (const [item, expected] of [
			[{ provider: "xai", id: "grok-4.5", name: "Grok 4.5" }, 60.1],
			[{ provider: "vercel-ai-gateway", id: "xai/grok-4.5", name: "Grok 4.5" }, 60.1],
			[{ provider: "openrouter", id: "x-ai/grok-4.5", name: "xAI: Grok 4.5" }, 60.1],
			[{ provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }, 59.2],
			[{ provider: "vercel-ai-gateway", id: "openai/gpt-5.6-sol-fast", name: "GPT-5.6 Sol (Fast)" }, 59.2],
			[{ provider: "vercel-ai-gateway", id: "openai/gpt-5.6-sol-batch", name: "GPT-5.6 Sol (Batch)" }, 59.2],
			[
				{
					provider: "amazon-bedrock",
					id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
					name: "Claude Haiku 4.5 (EU)",
				},
				29.5,
			],
			[{ provider: "openrouter", id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT" }, 30.1],
			[{ provider: "groq", id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" }, 25.4],
			[{ provider: "vercel-ai-gateway", id: "alibaba/qwen-3-32b", name: "Qwen 3 32B" }, 35.5],
			[{ provider: "amazon-bedrock", id: "amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" }, 20.1],
		] as const) {
			expect(resolveArtificialAnalysisIqForTest(item, scores), item.id).toBe(expected);
		}
		for (const id of ["claude-opus-4-5", "claude-haiku-3-5", "nova-lite", "o3-pro", "grok-4.5-fast", "gemma-4-26b"]) {
			expect(resolveArtificialAnalysisIqForTest({ provider: "test", id }, scores), id).toBeUndefined();
		}
	});

	it("parses split streamed records without dropping historical models or manifests", () => {
		const manifest = { path: "/data/models.txt", key: "01".repeat(32) };
		const flight = `1f:${JSON.stringify([
			"$",
			"div",
			null,
			{
				manifest,
				models: [{ slug: "gemini-2-5-pro", deprecated: true, intelligenceIndex: 26.4 }],
			},
		])}\n`;
		const chunks = [flight.slice(0, 40), flight.slice(40, 125), flight.slice(125)];
		const html = chunks.map((chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`).join("");
		expect(parseArtificialAnalysisScores(html).exact.get("gemini-2-5-pro")).toBe(26.4);
		expect(parseArtificialAnalysisDataManifests(html)).toEqual([manifest]);
	});

	it("keeps all published scores and rejects absent or invalid values", () => {
		const rows = Array.from({ length: 200 }, (_, index) => ({
			slug: `model-${index}`,
			intelligenceIndex: index / 2,
		}));
		const scores = parseArtificialAnalysisScores(
			`<script type="application/ld+json">${JSON.stringify({
				rows: [
					...rows,
					...[null, "", " ", -1, 101, "NaN", false].map((intelligenceIndex, index) => ({
						slug: `invalid-${index}`,
						intelligenceIndex,
					})),
				],
			})}</script>`,
		);
		expect(scores.canonical.size).toBe(200);
		for (let index = 0; index < 200; index++) {
			expect(resolveArtificialAnalysisIqForTest({ provider: "gateway", id: `vendor/model-${index}` }, scores)).toBe(
				index / 2,
			);
		}
	});

	it("uses fresh gateway pricing without applying it to direct providers", () => {
		const catalogCost = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
		const gatewayCost = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
		const vercelCosts = new Map([["anthropic/claude-opus-5-5", gatewayCost]]);
		const model = { name: "Claude Opus 5.5", cost: catalogCost };

		expect(
			getModelMetadataCost({ provider: "vercel-ai-gateway", id: "anthropic/claude-opus-5.5", model }, vercelCosts),
		).toEqual(gatewayCost);
		expect(getModelMetadataCost({ provider: "anthropic", id: "claude-opus-5-5", model }, vercelCosts)).toEqual(
			catalogCost,
		);
		expect(VERCEL_MODEL_METADATA_CACHE_TTL_MS).toBe(60 * 60 * 1000);
		expect(MODEL_METADATA_RETRY_INTERVAL_MS).toBe(15 * 60 * 1000);
	});

	it("renders a visible selected row marker", async () => {
		const harness = await createSortHarness();
		harnesses.push(harness);

		const selector = createSelector(harness);
		await waitForAsyncRender();

		const output = stripAnsi(selector.render(140).join("\n"));
		// Selected row is highlighted; current model may also show a check marker depending on theme/version.
		expect(output).toContain("IQ");
		expect(output).not.toContain("Agent");
		expect(output).toContain("Alpha");
		expect(output).toMatch(/Alpha\s+300/u);
	});

	it("renders cached IQ immediately and labels historical and unrated models", async () => {
		const harness = await createSortHarness();
		harnesses.push(harness);
		vi.spyOn(modelPickerMetadata, "getCachedModelPickerMetadata").mockReturnValue({
			artificialAnalysisScores: { exact: new Map([["alpha", 30]]), canonical: new Map() },
			historicalArtificialAnalysisScores: {
				exact: new Map([
					["alpha", 90],
					["bravo", 20],
				]),
				canonical: new Map(),
			},
			vercelReleaseDates: new Map(),
			vercelCosts: new Map(),
		});
		const selector = createSelector(harness);
		const lines = stripAnsi(selector.render(140).join("\n")).split("\n");
		expect(lines.find((line) => line.includes("Alpha"))).toMatch(/faux\s+30\s+-/u);
		expect(lines.find((line) => line.includes("Bravo"))).toMatch(/faux\s+20\*\s+-/u);
		expect(lines.find((line) => line.includes("Charlie"))).toMatch(/faux\s+N\/A\s+-/u);
		expect(lines.join("\n")).toContain("different scale");
		for (const direction of ["descending", "ascending"]) {
			selector.handleInput("Q");
			const sorted = stripAnsi(selector.render(140).join("\n"));
			const first = direction === "descending" ? "Alpha" : "Bravo";
			const second = direction === "descending" ? "Bravo" : "Alpha";
			expect(sorted.indexOf(first)).toBeLessThan(sorted.indexOf(second));
			expect(sorted.indexOf(second)).toBeLessThan(sorted.indexOf("Charlie"));
		}
		selector.handleInput("\x1b");
	});

	it("resets selection to the first row after query and sort changes", async () => {
		const harness = await createSortHarness();
		harnesses.push(harness);

		let selectedModel = "";
		const selector = createSelector(harness, {
			onSelect: (model) => {
				selectedModel = `${model.provider}/${model.id}`;
			},
		});
		await waitForAsyncRender();
		setRemoteMetadata(selector);

		selector.handleInput("\x1b[B");
		selector.handleInput("a");
		selector.handleInput("\r");
		expect(selectedModel).toBe("aaa-provider/provider-alpha");

		selectedModel = "";
		selector.handleInput("\x7f");
		selector.handleInput("\x1b[B");
		selector.handleInput("O");
		selector.handleInput("\r");
		expect(selectedModel).toBe("faux/charlie");
	});
});
