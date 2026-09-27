import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@dotkaio/dot-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const tempDirectories: string[] = [];

afterEach(() => {
	delete process.env.DOT_RUNTIME_POLICY_PATH;
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function model(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10000,
		maxTokens: 1000,
	};
}

describe("ModelRuntime runtime policy", () => {
	it("exposes only the locked model and rejects a direct request bypass", async () => {
		const directory = mkdtempSync(join(tmpdir(), "model-runtime-policy-"));
		tempDirectories.push(directory);
		const policyPath = join(directory, "policy.json");
		writeFileSync(policyPath, JSON.stringify({ lockedModel: { provider: "locked-provider", id: "allowed-model" } }));
		process.env.DOT_RUNTIME_POLICY_PATH = policyPath;

		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		runtime.registerProvider("locked-provider", {
			baseUrl: "https://example.test/v1",
			apiKey: "test-key",
			api: "openai-completions",
			models: [model("allowed-model"), model("blocked-model")],
		});

		expect(runtime.getModels().map((entry) => `${entry.provider}/${entry.id}`)).toEqual([
			"locked-provider/allowed-model",
		]);
		expect(runtime.getModel("locked-provider", "blocked-model")).toBeUndefined();

		const blocked = {
			...runtime.getModel("locked-provider", "allowed-model")!,
			id: "blocked-model",
		} as Model<Api>;
		const prepareRequest = (
			runtime as unknown as {
				prepareRequest(model: Model<Api>, options: undefined): Promise<unknown>;
			}
		).prepareRequest.bind(runtime);
		await expect(prepareRequest(blocked, undefined)).rejects.toMatchObject({
			code: "model_validation",
			message: "Runtime policy permits only locked-provider/allowed-model",
		});
	});
});
