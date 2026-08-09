import { isDeepStrictEqual } from "node:util";
import type { Api, Model, ModelsStoreEntry, Provider } from "@dotkaio/dot-ai";
import { VERSION } from "../config.ts";
import { getDotUserAgent } from "../utils/dot-user-agent.ts";

const DEFAULT_CATALOG_BASE_URL = "https://raw.githubusercontent.com/dotkaio/dot/main/model-catalog/";
export const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

function hasTrustedRoutingProfile(candidate: Model<Api>, trusted: Model<Api>): boolean {
	return (
		candidate.api === trusted.api &&
		candidate.baseUrl === trusted.baseUrl &&
		isDeepStrictEqual(candidate.headers, trusted.headers) &&
		isDeepStrictEqual(candidate.compat, trusted.compat)
	);
}

function applyRemoteMetadata(remote: Model<Api>, trusted: Model<Api>): Model<Api> {
	return {
		id: remote.id,
		name: remote.name,
		api: trusted.api,
		provider: trusted.provider,
		baseUrl: trusted.baseUrl,
		reasoning: remote.reasoning,
		thinkingLevelMap: remote.thinkingLevelMap,
		input: remote.input,
		cost: remote.cost,
		contextWindow: remote.contextWindow,
		maxTokens: remote.maxTokens,
		headers: trusted.headers,
		compat: trusted.compat,
	};
}

/** Remote catalogs may update model metadata, but never credential-routing fields. */
function trustedRemoteModels(baseline: readonly Model<Api>[], remote: readonly Model<Api>[]): Model<Api>[] {
	return remote.flatMap((model) => {
		const existing = baseline.find((entry) => entry.id === model.id);
		if (existing) return [applyRemoteMetadata(model, existing)];
		const trustedProfile = baseline.find((entry) => hasTrustedRoutingProfile(model, entry));
		return trustedProfile ? [applyRemoteMetadata(model, trustedProfile)] : [];
	});
}

function mergeModels(baseline: readonly Model<Api>[], dynamic: readonly Model<Api>[]): Model<Api>[] {
	const merged = [...baseline];
	for (const model of dynamic) {
		const index = merged.findIndex((entry) => entry.id === model.id);
		if (index >= 0) merged[index] = model;
		else merged.push(model);
	}
	return merged;
}

function parseCatalog(providerId: string, value: unknown): Model<Api>[] {
	const entries = Array.isArray(value)
		? value
		: typeof value === "object" && value !== null && "models" in value && Array.isArray(value.models)
			? value.models
			: typeof value === "object" && value !== null
				? Object.values(value)
				: undefined;
	if (!entries) throw new Error(`Invalid model catalog for provider "${providerId}"`);
	return entries
		.filter(
			(entry): entry is Model<Api> =>
				typeof entry === "object" && entry !== null && "id" in entry && typeof entry.id === "string",
		)
		.map((model) => ({ ...model, provider: providerId }));
}

function remoteModels(
	entry: ModelsStoreEntry | undefined,
	localGeneratedAt: number | undefined,
): readonly Model<Api>[] {
	if (!entry) return [];
	if (localGeneratedAt !== undefined && (entry.lastModified === undefined || entry.lastModified <= localGeneratedAt)) {
		return [];
	}
	return entry.models;
}

/** Add a persisted Dot catalog overlay to a static built-in provider. */
export function withRemoteCatalog(
	provider: Provider,
	catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
	localGeneratedAt?: number,
): Provider {
	let dynamicModels: readonly Model<Api>[] = [];
	let inflightRefresh: Promise<void> | undefined;

	return {
		...provider,
		getModels: () => mergeModels(provider.getModels(), dynamicModels),
		refreshModels: (context) => {
			inflightRefresh ??= (async () => {
				try {
					const baseline = provider.getModels();
					const stored = await context.store.read();
					const trustedStored = stored
						? {
								...stored,
								models: trustedRemoteModels(
									baseline,
									stored.models.filter((model) => model.provider === provider.id),
								),
							}
						: undefined;
					dynamicModels = remoteModels(trustedStored, localGeneratedAt);
					if (!context.allowNetwork || context.signal?.aborted) return;
					if (
						!context.force &&
						trustedStored?.checkedAt !== undefined &&
						trustedStored.lastModified !== undefined &&
						Date.now() - trustedStored.checkedAt < REMOTE_CATALOG_REFRESH_INTERVAL_MS
					) {
						return;
					}

					// Only revalidate when a cached body backs the validator, so a 304 can never
					// leave the overlay empty.
					const validator = trustedStored?.models.length ? trustedStored.etag : undefined;
					const baseUrl = `${catalogBaseUrl.replace(/\/+$/u, "")}/`;
					const url = new URL(`providers/${encodeURIComponent(provider.id)}.json`, baseUrl);
					const response = await fetch(url, {
						headers: {
							accept: "application/json",
							"User-Agent": getDotUserAgent(VERSION),
							...(validator ? { "if-none-match": validator } : {}),
						},
						signal: context.signal,
					});
					if (context.signal?.aborted) return;
					const checkedAt = Date.now();
					// Unchanged: dynamicModels already holds the stored overlay, so only the
					// freshness window moves.
					if (response.status === 304 && trustedStored) {
						await context.store.write({ ...trustedStored, checkedAt });
						return;
					}
					if (response.status === 404 || response.status === 501) {
						await context.store.write({
							...(trustedStored ?? { models: [] }),
							checkedAt,
							lastModified: 0,
							etag: undefined,
						});
						return;
					}
					if (!response.ok) {
						// Transient failure: the cached body and its validator stay valid, so keep the
						// etag and let the next refresh revalidate instead of downloading the catalog.
						await context.store.write({ ...(trustedStored ?? { models: [] }), checkedAt });
						throw new Error(`Model catalog request failed for ${provider.id}: ${response.status}`);
					}
					const refreshed = trustedRemoteModels(baseline, parseCatalog(provider.id, await response.json()));
					const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
					if (context.signal?.aborted) return;
					const entry = {
						models: refreshed,
						checkedAt,
						lastModified: Number.isNaN(lastModified) ? 0 : lastModified,
						etag: response.headers.get("etag") ?? undefined,
					};
					dynamicModels = remoteModels(entry, localGeneratedAt);
					await context.store.write(entry);
				} finally {
					inflightRefresh = undefined;
				}
			})();
			return inflightRefresh;
		},
	};
}
