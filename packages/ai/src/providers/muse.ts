import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadMuseOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

/**
 * Meta Model API (Muse Spark family).
 *
 * Hand-maintained catalog: Meta Model API is not part of the generated
 * models.dev pipeline, and Meta publishes a small fixed, versioned model list.
 * IDs, limits, and pricing follow Meta's official docs
 * (https://dev.meta.ai/docs/quickstart, https://dev.meta.ai/docs/pricing-rate-limits):
 * 1,048,576-token context, 131,072 output tokens, standard tier at
 * $1.25/$4.25 per 1M input/output tokens ($0.15 cached input), contributor
 * tier at $0.10/$0.20 ($0.002 cached).
 */
const MUSE_BASE_URL = "https://api.meta.ai/v1";

const MUSE_COMPAT = {
	supportsDeveloperRole: false,
	supportsStrictMode: false,
	supportsLongCacheRetention: false,
};

// Meta documents "high" reasoning effort and encrypted reasoning replay;
// "off"/"minimal" are not advertised, so reasoning-off clamps to "low".
const MUSE_THINKING_LEVEL_MAP = {
	off: null,
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
};

const MUSE_STANDARD_COST = { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 };
const MUSE_CONTRIBUTOR_COST = { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 };

function museSparkModel(id: string, name: string, cost: Model<"openai-responses">["cost"]): Model<"openai-responses"> {
	return {
		id,
		name,
		api: "openai-responses",
		provider: "muse",
		baseUrl: MUSE_BASE_URL,
		reasoning: true,
		input: ["text", "image"],
		cost,
		contextWindow: 1048576,
		maxTokens: 131072,
		thinkingLevelMap: MUSE_THINKING_LEVEL_MAP,
		compat: MUSE_COMPAT,
	};
}

export const MUSE_MODELS: Model<"openai-responses">[] = [
	museSparkModel("muse-spark-1.3", "Muse Spark 1.3", MUSE_STANDARD_COST),
	museSparkModel("muse-spark-1.2", "Muse Spark 1.2", MUSE_STANDARD_COST),
	museSparkModel("muse-spark-1.1", "Muse Spark 1.1", MUSE_STANDARD_COST),
	museSparkModel("muse-spark-1.3-contributor", "Muse Spark 1.3 Contributor", MUSE_CONTRIBUTOR_COST),
	museSparkModel("muse-spark-1.2-contributor", "Muse Spark 1.2 Contributor", MUSE_CONTRIBUTOR_COST),
];

/** Meta Model API provider, named after its Muse model family. */
export function museProvider(): Provider<"openai-responses"> {
	return createProvider({
		id: "muse",
		name: "Muse",
		baseUrl: "https://api.meta.ai/v1",
		auth: {
			apiKey: envApiKeyAuth("Meta Model API key", ["MODEL_API_KEY", "META_API_KEY"]),
			oauth: lazyOAuth({
				name: "Muse (Meta account)",
				loginLabel: "Sign in with a Meta account",
				load: loadMuseOAuth,
			}),
		},
		models: MUSE_MODELS,
		api: openAIResponsesApi(),
	});
}
