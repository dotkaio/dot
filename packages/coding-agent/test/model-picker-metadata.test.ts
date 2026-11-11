import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ARTIFICIAL_ANALYSIS_CACHE_TTL_MS,
	getArtificialAnalysisIq,
	getCachedModelPickerMetadata,
	getModelPickerMetadata,
	MODEL_METADATA_RETRY_INTERVAL_MS,
} from "../src/core/model-picker-metadata.ts";
import { allowNetwork } from "./test-network-env.ts";

function flightPage(value: unknown): string {
	const flight = `1f:${JSON.stringify(["$", "div", null, value])}\n`;
	return [flight.slice(0, 60), flight.slice(60)]
		.map((chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`)
		.join("");
}

describe("model picker metadata refresh", () => {
	let agentDir: string | undefined;

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		if (agentDir) rmSync(agentDir, { recursive: true, force: true });
	});

	it("loads the full model feed, ignores agent caches, and preserves IQ through partial/429 refreshes", async () => {
		agentDir = mkdtempSync(join(tmpdir(), "dot-iq-cache-"));
		vi.stubEnv("DOT_CODING_AGENT_DIR", agentDir);
		allowNetwork();
		let now = 2_000_000_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const cachePath = join(agentDir, "model-picker-metadata.json");
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				artificialAnalysis: {
					lastAttemptAt: now,
					lastSuccessAt: now,
					nextRefreshAt: now + ARTIFICIAL_ANALYSIS_CACHE_TTL_MS,
					data: { exact: [["agent-only", 99]], canonical: [["agent-only", 99]], breakdowns: [] },
				},
			}),
		);
		writeFileSync(
			join(agentDir, "model-agent-score-cache.json"),
			JSON.stringify({
				version: 1,
				fetchedAt: now,
				exact: [["agent-only", 99]],
				canonical: [["agent-only", 99]],
			}),
		);
		expect(getCachedModelPickerMetadata().artificialAnalysisScores.exact.size).toBe(0);

		const manifest = { path: "/data/models.txt", key: "01".repeat(32) };
		const payload = [
			{ slug: "gemini-4-argon", intelligenceIndex: 50.1 },
			{ slug: "gpt-5-6-terra", deprecated: true, intelligenceIndex: 32.3 },
			{ slug: "unrated", intelligenceIndex: null, codingIndex: 99 },
		];
		const compressed = await new Response(
			new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer();
		const keyBytes = new Uint8Array(32).fill(1);
		const digest = await crypto.subtle.digest("SHA-256", keyBytes);
		const iv = new Uint8Array(digest).slice(0, 12);
		const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
		const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, compressed);

		let mode: "partial" | "complete" | "limited" = "partial";
		const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
			const url = String(input);
			if (mode === "limited") return new Response("rate limited", { status: 429 });
			if (url.endsWith("/v1/models")) {
				return Response.json({
					data: [
						{
							id: "google/gemini-4-argon",
							released: "2026-10-13",
							pricing: { input: "0.000002", output: "0.00001" },
						},
					],
				});
			}
			if (url.includes("/articles/")) {
				return new Response(flightPage({ models: [{ slug: "gpt-5-6-sol", intelligenceIndex: 47.1 }] }));
			}
			if (url.endsWith(manifest.path)) {
				return mode === "partial" ? new Response("rate limited", { status: 429 }) : new Response(encrypted);
			}
			expect(url).toBe("https://artificialanalysis.ai/leaderboards/models");
			return new Response(flightPage({ models: [{ slug: "gemini-4-argon", intelligenceIndex: 50.1 }], manifest }));
		});
		vi.stubGlobal("fetch", fetchMock);

		const [partial, shared] = await Promise.all([getModelPickerMetadata(), getModelPickerMetadata()]);
		expect(shared).toEqual(partial);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(partial.artificialAnalysisScores.exact.get("gemini-4-argon")).toBe(50.1);
		expect(partial.artificialAnalysisScores.exact.has("agent-only")).toBe(false);
		expect(partial.historicalArtificialAnalysisScores.exact.get("gpt-5-6-sol")).toBe(47.1);
		let stored = JSON.parse(readFileSync(cachePath, "utf8"));
		expect(stored.version).toBe(2);
		expect(stored.artificialAnalysis.lastSuccessAt).toBeUndefined();
		expect(stored.artificialAnalysis.nextRefreshAt).toBe(now + MODEL_METADATA_RETRY_INTERVAL_MS);
		await getModelPickerMetadata();
		expect(fetchMock).toHaveBeenCalledTimes(4);

		mode = "complete";
		now += MODEL_METADATA_RETRY_INTERVAL_MS;
		const complete = await getModelPickerMetadata();
		expect(fetchMock).toHaveBeenCalledTimes(6);
		expect(complete.artificialAnalysisScores.exact.get("gpt-5-6-terra")).toBe(32.3);
		expect(complete.artificialAnalysisScores.exact.has("unrated")).toBe(false);
		expect(
			getArtificialAnalysisIq(
				{
					provider: "openai-codex",
					id: "gpt-5.6-terra",
					model: { name: "GPT-5.6 Terra", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
				},
				complete.artificialAnalysisScores,
			),
		).toBe(32.3);
		const successAt = now;

		mode = "limited";
		now += ARTIFICIAL_ANALYSIS_CACHE_TTL_MS;
		const refreshing = getModelPickerMetadata();
		// No await: stale scores remain available while remote requests are pending.
		expect(getCachedModelPickerMetadata().artificialAnalysisScores).toEqual(complete.artificialAnalysisScores);
		const limited = await refreshing;
		expect(limited).toEqual(complete);
		stored = JSON.parse(readFileSync(cachePath, "utf8"));
		expect(stored.artificialAnalysis.lastSuccessAt).toBe(successAt);
		expect(stored.artificialAnalysis.nextRefreshAt).toBe(now + MODEL_METADATA_RETRY_INTERVAL_MS);
		expect(fetchMock).toHaveBeenCalledTimes(9);
		await getModelPickerMetadata();
		expect(fetchMock).toHaveBeenCalledTimes(9);

		mode = "partial";
		now += MODEL_METADATA_RETRY_INTERVAL_MS;
		const retry = await getModelPickerMetadata();
		expect(retry.artificialAnalysisScores).toEqual(complete.artificialAnalysisScores);
		expect(JSON.parse(readFileSync(cachePath, "utf8")).artificialAnalysis.lastSuccessAt).toBe(successAt);
		vi.stubEnv("DOT_OFFLINE", "1");
		fetchMock.mockClear();
		expect(await getModelPickerMetadata()).toEqual(retry);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
