/**
 * Persistent lifetime spend totals per provider.
 * Used by the TUI footer for non-Vercel harnesses (remaining balance is Vercel-only).
 */

import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { type AuthStorageBackend, FileAuthStorageBackend } from "./auth-storage.ts";

export const VERCEL_AI_GATEWAY_PROVIDER = "vercel-ai-gateway";

/** True when the active harness should show remaining AI Gateway balance. */
export function isVercelAiGatewayProvider(provider: string | null | undefined): boolean {
	return provider === VERCEL_AI_GATEWAY_PROVIDER;
}

/** Map of provider id → cumulative USD spend since first tracked use. */
export type ProviderSpendData = Record<string, number>;

export function getProviderSpendPath(): string {
	return join(getAgentDir(), "provider-spend.json");
}

function parseSpend(content: string | undefined): ProviderSpendData {
	if (!content) return {};
	try {
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: ProviderSpendData = {};
		for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof provider !== "string" || provider.length === 0) continue;
			const amount = typeof value === "number" ? value : Number(value);
			if (Number.isFinite(amount) && amount >= 0) {
				out[provider] = amount;
			}
		}
		return out;
	} catch {
		return {};
	}
}

export interface ProviderSpendStore {
	/** Lifetime total USD spent for a provider (0 if never tracked). */
	getTotal(provider: string): number;
	/**
	 * Add a positive spend amount for a provider and persist.
	 * Returns the new total. No-ops for invalid inputs.
	 */
	addSpend(provider: string, amount: number): number;
}

/**
 * Locked JSON-backed lifetime spend store.
 * Totals only increase; they never reset automatically.
 */
export class FileProviderSpendStore implements ProviderSpendStore {
	private readonly storage: AuthStorageBackend;
	/** In-memory cache so footer renders stay sync/cheap. */
	private cache: ProviderSpendData | undefined;

	constructor(path: string = getProviderSpendPath()) {
		this.storage = new FileAuthStorageBackend(path);
	}

	getTotal(provider: string): number {
		if (!provider) return 0;
		if (!this.cache) {
			this.cache = this.readAll();
		}
		return this.cache[provider] ?? 0;
	}

	addSpend(provider: string, amount: number): number {
		if (!provider || !Number.isFinite(amount) || amount <= 0) {
			return this.getTotal(provider);
		}

		return this.storage.withLock((content) => {
			const data = parseSpend(content);
			const previous = data[provider] ?? 0;
			const next = previous + amount;
			data[provider] = next;
			this.cache = data;
			return { result: next, next: JSON.stringify(data, null, 2) };
		});
	}

	private readAll(): ProviderSpendData {
		return this.storage.withLock((content) => ({
			result: parseSpend(content),
		}));
	}
}
