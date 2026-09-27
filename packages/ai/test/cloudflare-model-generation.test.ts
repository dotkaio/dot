import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL,
	CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
} from "../src/api/cloudflare.ts";
import type { Api, Model } from "../src/types.ts";

const temporaryRoots: string[] = [];
const sourceModel = {
	id: "@cf/test/tool-model",
	name: "Test model",
	tool_call: true,
	reasoning: true,
	modalities: { input: ["text"] },
	limit: { context: 32000, output: 4000 },
	cost: { input: 1, output: 2 },
};

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function generateCatalog(
	source: Record<string, { models: Record<string, typeof sourceModel> }>,
): Record<string, Record<string, Model<Api>>> {
	const root = mkdtempSync(join(tmpdir(), "dot-cloudflare-generation-"));
	temporaryRoots.push(root);
	const preload = join(root, "fetch-fixture.mjs");
	const output = join(root, "catalog");
	writeFileSync(
		preload,
		`const source = ${JSON.stringify(source)};
globalThis.fetch = async (url) => {
  if (url === "https://models.dev/api.json") return Response.json(source);
  if (url === "https://openrouter.ai/api/v1/models" || url === "https://ai-gateway.vercel.sh/v1/models") {
    return Response.json({ data: [] });
  }
  throw new Error("Unexpected network request: " + url);
};
`,
	);
	execFileSync(
		process.execPath,
		[
			"--import",
			preload,
			fileURLToPath(new URL("../scripts/generate-models.ts", import.meta.url)),
			"--strict",
			"--json-only",
			"--json-output",
			output,
		],
		{ encoding: "utf8", timeout: 15000 },
	);
	return JSON.parse(readFileSync(join(output, "models.json"), "utf8"));
}

describe("Cloudflare AI Gateway model generation", () => {
	it.each([true, false])("retains Workers AI when Gateway listing exists: %s", (includeGateway) => {
		const source: Parameters<typeof generateCatalog>[0] = {
			"cloudflare-workers-ai": {
				models: {
					[sourceModel.id]: sourceModel,
					"@cf/test/no-tools": { ...sourceModel, id: "@cf/test/no-tools", tool_call: false },
				},
			},
		};
		if (includeGateway) source["cloudflare-ai-gateway"] = { models: {} };
		const catalog = generateCatalog(source);
		const model = catalog["cloudflare-ai-gateway"][`workers-ai/${sourceModel.id}`];

		expect(model).toMatchObject({
			id: `workers-ai/${sourceModel.id}`,
			provider: "cloudflare-ai-gateway",
			api: "openai-completions",
			baseUrl: CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
			contextWindow: 32000,
			maxTokens: 4000,
			cost: { input: 1, output: 2 },
			compat: {
				sendSessionAffinityHeaders: true,
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				maxTokensField: "max_tokens",
			},
		});
		expect(catalog["cloudflare-ai-gateway"]["workers-ai/@cf/test/no-tools"]).toBeUndefined();
		expect(catalog["cloudflare-workers-ai"][sourceModel.id].provider).toBe("cloudflare-workers-ai");
	});

	it("keeps explicit Gateway metadata instead of replacing it with Workers metadata", () => {
		const id = `workers-ai/${sourceModel.id}`;
		const catalog = generateCatalog({
			"cloudflare-workers-ai": { models: { [sourceModel.id]: sourceModel } },
			"cloudflare-ai-gateway": {
				models: { [id]: { ...sourceModel, id, cost: { input: 3, output: 4 } } },
			},
		});

		expect(catalog["cloudflare-ai-gateway"][id].cost).toMatchObject({ input: 3, output: 4 });
	});

	it("resolves dotted Anthropic aliases only when the native catalog confirms the ID", () => {
		const nativeId = "claude-sonnet-4-5";
		const unknownId = "claude-unknown-4.5";
		const catalog = generateCatalog({
			anthropic: { models: { [nativeId]: { ...sourceModel, id: nativeId } } },
			"cloudflare-ai-gateway": {
				models: {
					"anthropic/claude-sonnet-4.5": { ...sourceModel, id: "anthropic/claude-sonnet-4.5" },
					[`anthropic/${unknownId}`]: { ...sourceModel, id: `anthropic/${unknownId}` },
					"openai/gpt-4.1": { ...sourceModel, id: "openai/gpt-4.1" },
				},
			},
		});

		expect(catalog["cloudflare-ai-gateway"][nativeId]).toMatchObject({
			id: nativeId,
			api: "anthropic-messages",
			baseUrl: CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL,
		});
		expect(catalog["cloudflare-ai-gateway"]["claude-sonnet-4.5"]).toBeUndefined();
		expect(catalog["cloudflare-ai-gateway"][unknownId].id).toBe(unknownId);
		expect(catalog["cloudflare-ai-gateway"]["gpt-4.1"].api).toBe("openai-responses");
	});
});
