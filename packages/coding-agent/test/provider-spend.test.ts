import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FooterDataProvider } from "../src/core/footer-data-provider.ts";
import {
	FileProviderSpendStore,
	isVercelAiGatewayProvider,
	VERCEL_AI_GATEWAY_PROVIDER,
} from "../src/core/provider-spend.ts";

describe("isVercelAiGatewayProvider", () => {
	it("matches only the Vercel AI Gateway provider id", () => {
		expect(isVercelAiGatewayProvider(VERCEL_AI_GATEWAY_PROVIDER)).toBe(true);
		expect(isVercelAiGatewayProvider("openai-codex")).toBe(false);
		expect(isVercelAiGatewayProvider(undefined)).toBe(false);
		expect(isVercelAiGatewayProvider(null)).toBe(false);
	});
});

describe("FileProviderSpendStore", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("starts at zero and permanently accumulates spend per provider", () => {
		tempDir = mkdtempSync(join(tmpdir(), "provider-spend-"));
		const path = join(tempDir, "provider-spend.json");
		const store = new FileProviderSpendStore(path);

		expect(store.getTotal("openai-codex")).toBe(0);
		expect(store.addSpend("openai-codex", 1.25)).toBeCloseTo(1.25, 6);
		expect(store.addSpend("openai-codex", 0.75)).toBeCloseTo(2.0, 6);
		expect(store.getTotal("openai-codex")).toBeCloseTo(2.0, 6);
		expect(store.getTotal("anthropic")).toBe(0);

		// Survives a new store instance on the same file.
		const reloaded = new FileProviderSpendStore(path);
		expect(reloaded.getTotal("openai-codex")).toBeCloseTo(2.0, 6);
		expect(reloaded.addSpend("anthropic", 3.5)).toBeCloseTo(3.5, 6);

		const onDisk = JSON.parse(readFileSync(path, "utf-8")) as Record<string, number>;
		expect(onDisk["openai-codex"]).toBeCloseTo(2.0, 6);
		expect(onDisk.anthropic).toBeCloseTo(3.5, 6);
	});

	it("ignores non-positive and non-finite spend", () => {
		tempDir = mkdtempSync(join(tmpdir(), "provider-spend-"));
		const path = join(tempDir, "provider-spend.json");
		const store = new FileProviderSpendStore(path);

		expect(store.addSpend("xai", 0)).toBe(0);
		expect(store.addSpend("xai", -1)).toBe(0);
		expect(store.addSpend("xai", Number.NaN)).toBe(0);
		expect(store.addSpend("", 1)).toBe(0);
		expect(store.getTotal("xai")).toBe(0);
	});
});

describe("FooterDataProvider provider spend", () => {
	let tempDir: string;
	let originalFetch: typeof globalThis.fetch;
	let originalApiKey: string | undefined;

	afterEach(() => {
		if (originalFetch) {
			globalThis.fetch = originalFetch;
		}
		if (originalApiKey === undefined) {
			delete process.env.AI_GATEWAY_API_KEY;
		} else {
			process.env.AI_GATEWAY_API_KEY = originalApiKey;
		}
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("notifies listeners when lifetime provider spend increases", () => {
		tempDir = mkdtempSync(join(tmpdir(), "footer-provider-spend-"));
		originalFetch = globalThis.fetch;
		originalApiKey = process.env.AI_GATEWAY_API_KEY;
		delete process.env.AI_GATEWAY_API_KEY;
		globalThis.fetch = vi.fn(async () => {
			throw new Error("should not fetch without key");
		}) as unknown as typeof fetch;

		const spendPath = join(tempDir, "provider-spend.json");
		const provider = new FooterDataProvider(tempDir, {
			providerSpendStore: new FileProviderSpendStore(spendPath),
		});
		try {
			const onBalanceChange = vi.fn();
			provider.onBalanceChange(onBalanceChange);

			expect(provider.getProviderSpend("openai-codex")).toBe(0);
			provider.addProviderSpend("openai-codex", 0.4);
			expect(provider.getProviderSpend("openai-codex")).toBeCloseTo(0.4, 6);
			expect(onBalanceChange).toHaveBeenCalledTimes(1);

			provider.addProviderSpend("openai-codex", 0.1);
			expect(provider.getProviderSpend("openai-codex")).toBeCloseTo(0.5, 6);
			expect(onBalanceChange).toHaveBeenCalledTimes(2);
		} finally {
			provider.dispose();
		}
	});
});
