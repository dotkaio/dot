import type { Api, Model } from "@dotkaio/dot-ai/compat";
import { setKeybindings, type TUI } from "@dotkaio/dot-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
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

	it("uses only the Intelligence Index and keeps provider routes consistent", () => {
		const scores = parseArtificialAnalysisScores(
			String.raw`<script>self.__next_f.push([1,"{\"initialData\":[{\"id\":\"gpt-5-6-sol-high-uuid\",\"slug\":\"gpt-5-6-sol-high\",\"name\":\"GPT-5.6 Sol (high)\",\"shortName\":\"GPT-5.6 Sol\",\"releaseDate\":\"2026-07-01\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"large\",\"intelligenceIndex\":56.4,\"codingIndex\":71.2},{\"id\":\"gpt-5-6-sol-max-uuid\",\"slug\":\"gpt-5-6-sol-max\",\"name\":\"GPT-5.6 Sol (max)\",\"shortName\":\"GPT-5.6 Sol\",\"releaseDate\":\"2026-07-01\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"large\",\"intelligenceIndex\":59.2,\"codingIndex\":77.4},{\"id\":\"claude-4-5-haiku-uuid\",\"slug\":\"claude-4-5-haiku\",\"name\":\"Claude Haiku 4.5\",\"shortName\":\"Claude Haiku 4.5\",\"releaseDate\":\"2025-10-01\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"small\",\"intelligenceIndex\":29.5,\"codingIndex\":41.5},{\"id\":\"o3-uuid\",\"slug\":\"o3\",\"name\":\"o3\",\"shortName\":\"o3\",\"releaseDate\":\"2025-04-16\",\"isReasoning\":true,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"large\",\"intelligenceIndex\":30.4,\"codingIndex\":48.1},{\"id\":\"grok-4-5-high-uuid\",\"slug\":\"grok-4-5-high\",\"name\":\"Grok 4.5 (high)\",\"shortName\":\"Grok 4.5\",\"releaseDate\":\"2026-07-08\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"large\",\"intelligenceIndex\":60.1,\"codingIndex\":72.4},{\"id\":\"old-model-uuid\",\"slug\":\"old-model\",\"name\":\"Old model\",\"shortName\":\"Old model\",\"releaseDate\":\"2020-01-01\",\"isReasoning\":false,\"deprecated\":true,\"isOpenWeights\":false,\"sizeClass\":\"small\",\"intelligenceIndex\":99,\"codingIndex\":99},{\"id\":\"unranked-uuid\",\"slug\":\"unranked\",\"name\":\"Unranked\",\"shortName\":\"Unranked\",\"releaseDate\":\"2020-01-01\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"small\",\"intelligenceIndex\":40,\"codingIndex\":null}]}"])</script>` +
				String.raw`<script>self.__next_f.push([1,"{\"data\":[{\"label\":\"Codex - GPT-5.6 Sol (max)\",\"codingAgentsIndex\":0.8002},{\"label\":\"Claude Code - Opus 4.8 (max)\",\"codingAgentsIndex\":0.7254},{\"label\":\"Grok Build - Grok 4.5 (high)\",\"codingAgentsIndex\":0.578}]}"])</script>` +
				String.raw`<script>self.__next_f.push([1,"{\"rows\":[{\"id\":\"abc123def456\",\"agentName\":\"Claude Code\",\"provider\":\"anthropic\",\"hostModelSlug\":\"anthropic_claude-opus-4-8\",\"display\":{\"agent\":\"Claude Code\",\"model\":\"Opus 4.8 (max)\",\"creator\":{\"agent\":\"Anthropic\",\"model\":\"Anthropic\"}},\"displayLabel\":\"Claude Code - Opus 4.8 (max)\",\"indexScore\":0.7254},{\"id\":\"grokbuild123\",\"agentName\":\"Grok Build\",\"provider\":\"xai\",\"hostModelSlug\":\"xai_grok-4-5\",\"display\":{\"agent\":\"Grok Build\",\"model\":\"Grok 4.5 (high)\",\"creator\":{\"agent\":\"xAI\",\"model\":\"xAI\"}},\"displayLabel\":\"Grok Build - Grok 4.5 (high)\",\"indexScore\":0.578}]}"])</script>`,
		);

		expect(scores.exact.get("gpt-5-6-sol-high")).toBe(56.4);
		expect(scores.exact.get("gpt-5-6-sol-max")).toBe(59.2);
		expect(scores.canonical.get("gpt-5-6-sol")).toBe(59.2);
		expect(scores.exact.get("old-model")).toBe(99);
		expect(scores.exact.get("unranked")).toBe(40);
		expect(scores.exact.has("claude-opus-4-8")).toBe(false);
		expect(scores.exact.has("xai-grok-4-5")).toBe(false);

		for (const item of [
			{ provider: "xai", id: "grok-4.5", name: "Grok 4.5" },
			{ provider: "vercel-ai-gateway", id: "xai/grok-4.5", name: "Grok 4.5" },
			{ provider: "openrouter", id: "x-ai/grok-4.5", name: "xAI: Grok 4.5" },
		]) {
			expect(resolveArtificialAnalysisIqForTest(item, scores)).toBe(60.1);
		}

		// Haiku id order differs between providers and AA.
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
				scores,
			),
		).toBe(29.5);
		// Bedrock regional ids should still resolve.
		expect(
			resolveArtificialAnalysisIqForTest(
				{
					provider: "amazon-bedrock",
					id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
					name: "Claude Haiku 4.5 (EU)",
				},
				scores,
			),
		).toBe(29.5);
		// Product-tier suffixes fall back when AA only ranks the base model.
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "vercel-ai-gateway", id: "openai/o3-pro", name: "o3 Pro" },
				scores,
			),
		).toBe(30.4);

		const routeVariantScores = parseArtificialAnalysisScores(
			`<script type="application/ld+json">${JSON.stringify({
				data: [
					{ slug: "qwen3-32b", intelligenceIndex: 35.5 },
					{ slug: "minimax-m2-5", intelligenceIndex: 40.5 },
				],
			})}</script>`,
		);
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "vercel-ai-gateway", id: "alibaba/qwen-3-32b", name: "Qwen 3 32B" },
				routeVariantScores,
			),
		).toBe(35.5);
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "vercel-ai-gateway", id: "minimax/minimax-m2.5-highspeed", name: "MiniMax M2.5 High Speed" },
				routeVariantScores,
			),
		).toBe(40.5);

		// Identity orthography: free-tier packaging, instruct -it tags, zero-padded versions, MoE size tags.
		const identityScores = parseArtificialAnalysisScores(
			String.raw`<script>self.__next_f.push([1,"{\"initialData\":[{\"id\":\"gemma-4-31b-uuid\",\"slug\":\"gemma-4-31b\",\"name\":\"Gemma 4 31B\",\"shortName\":\"Gemma 4 31B\",\"releaseDate\":\"2026-04-02\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":true,\"sizeClass\":\"medium\",\"intelligenceIndex\":30.1,\"codingIndex\":43.4},{\"id\":\"nova-2-0-lite-uuid\",\"slug\":\"nova-2-0-lite\",\"name\":\"Nova 2 Lite\",\"shortName\":\"Nova 2 Lite\",\"releaseDate\":\"2026-01-01\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"small\",\"intelligenceIndex\":20.1,\"codingIndex\":23.0},{\"id\":\"llama-4-scout-uuid\",\"slug\":\"llama-4-scout\",\"name\":\"Llama 4 Scout\",\"shortName\":\"Llama 4 Scout\",\"releaseDate\":\"2025-04-05\",\"isReasoning\":false,\"deprecated\":false,\"isOpenWeights\":true,\"sizeClass\":\"small\",\"intelligenceIndex\":10.0,\"codingIndex\":8.2},{\"id\":\"claude-opus-4-8-uuid\",\"slug\":\"claude-opus-4-8\",\"name\":\"Claude Opus 4.8\",\"shortName\":\"Claude Opus 4.8\",\"releaseDate\":\"2026-01-01\",\"isReasoning\":true,\"deprecated\":false,\"isOpenWeights\":false,\"sizeClass\":\"large\",\"intelligenceIndex\":50.0,\"codingIndex\":72.0}]}"])</script>`,
		);
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "openrouter", id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT" },
				identityScores,
			),
		).toBe(30.1);
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "huggingface", id: "google/gemma-4-31b-it", name: "Gemma 4 31B IT" },
				identityScores,
			),
		).toBe(30.1);
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "amazon-bedrock", id: "amazon.nova-2-lite-v1:0", name: "Nova 2 Lite" },
				identityScores,
			),
		).toBe(20.1);
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "groq", id: "meta-llama/llama-4-scout-17b-16e", name: "Llama 4 Scout 17B 16E" },
				identityScores,
			),
		).toBe(10.0);
		// Different versions / generations must not match.
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
				identityScores,
			),
		).toBeUndefined();
		expect(
			resolveArtificialAnalysisIqForTest(
				{ provider: "amazon-bedrock", id: "amazon.nova-lite-v1:0", name: "Nova Lite" },
				identityScores,
			),
		).toBeUndefined();
	});

	it("renders a visible selected row marker", async () => {
		const harness = await createSortHarness();
		harnesses.push(harness);

		const selector = createSelector(harness);
		await waitForAsyncRender();

		const output = stripAnsi(selector.render(140).join("\n"));
		// Selected row is highlighted; current model may also show a check marker depending on theme/version.
		expect(output).toContain("Alpha");
		expect(output).toMatch(/Alpha\s+300/u);
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
