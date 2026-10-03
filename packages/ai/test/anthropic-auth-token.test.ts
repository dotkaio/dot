import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV } from "../src/env-api-keys.ts";
import { createModels } from "../src/models.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import type { Context, Model } from "../src/types.ts";

const mockState: { headers?: Headers; createParams?: Record<string, unknown> } = {};

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init?: RequestInit) => {
			mockState.headers = new Headers(init?.headers);
			mockState.createParams = JSON.parse(String(init?.body)) as Record<string, unknown>;
			const events = [
				{ type: "message_start", message: { id: "msg_test", usage: { input_tokens: 1, output_tokens: 0 } } },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
				{ type: "message_stop" },
			];
			return new Response(
				events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
				{
					headers: { "content-type": "text/event-stream" },
				},
			);
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	mockState.headers = undefined;
	mockState.createParams = undefined;
});

const context: Context = {
	systemPrompt: "System prompt.",
	messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
};

const anthropicModel: Model<"anthropic-messages"> = {
	id: "claude-test",
	name: "Claude Test",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 4096,
};

describe("Anthropic auth token env", () => {
	it("resolves ANTHROPIC_AUTH_TOKEN as a bearer Authorization header", async () => {
		const provider = anthropicProvider();
		const auth = await provider.auth.apiKey?.resolve({
			ctx: {
				env: async (name) =>
					({
						ANTHROPIC_AUTH_TOKEN: "auth-token",
						ANTHROPIC_OAUTH_TOKEN: "oauth-token",
						ANTHROPIC_API_KEY: "api-key",
					})[name],
				fileExists: async () => false,
			},
		});

		expect(auth).toEqual({
			auth: { headers: { Authorization: "Bearer auth-token" } },
			source: ANTHROPIC_AUTH_TOKEN_ENV,
		});
	});

	it("preserves ANTHROPIC_OAUTH_TOKEN as OAuth-shaped API auth", async () => {
		const provider = anthropicProvider();
		const auth = await provider.auth.apiKey?.resolve({
			ctx: {
				env: async (name) =>
					({
						ANTHROPIC_OAUTH_TOKEN: "oauth-token",
						ANTHROPIC_API_KEY: "api-key",
					})[name],
				fileExists: async () => false,
			},
		});

		expect(auth).toEqual({
			auth: { apiKey: "oauth-token" },
			source: ANTHROPIC_OAUTH_TOKEN_ENV,
		});
	});

	it("uses Authorization headers without OAuth-mode request shaping", async () => {
		const stream = streamAnthropic(anthropicModel, context, {
			headers: { Authorization: "Bearer gateway-token" },
		});
		await stream.result();

		expect(mockState.headers?.get("x-api-key")).toBeNull();
		const headers = mockState.headers!;
		expect(headers.get("authorization")).toBe("Bearer gateway-token");
		expect(headers.get("anthropic-beta") ?? "").not.toContain("oauth-2025-04-20");
		expect(mockState.createParams?.system).toEqual([expect.objectContaining({ text: "System prompt." })]);
	});

	it("threads authContext ANTHROPIC_AUTH_TOKEN through request headers", async () => {
		const models = createModels({
			authContext: {
				env: async (name) => (name === "ANTHROPIC_AUTH_TOKEN" ? "ctx-token" : undefined),
				fileExists: async () => false,
			},
		});
		models.setProvider(anthropicProvider());

		await models.streamSimple(anthropicModel, context).result();

		expect(mockState.headers?.get("x-api-key")).toBeNull();
		const headers = mockState.headers!;
		expect(headers.get("authorization")).toBe("Bearer ctx-token");
		expect(headers.get("anthropic-beta") ?? "").not.toContain("oauth-2025-04-20");
		expect(mockState.createParams?.system).toEqual([expect.objectContaining({ text: "System prompt." })]);
	});

	it("preserves OAuth request shaping for ANTHROPIC_OAUTH_TOKEN", async () => {
		const models = createModels({
			authContext: {
				env: async (name) => (name === "ANTHROPIC_OAUTH_TOKEN" ? "sk-ant-oat-test" : undefined),
				fileExists: async () => false,
			},
		});
		models.setProvider(anthropicProvider());

		await models.streamSimple(anthropicModel, context).result();

		expect(mockState.headers?.get("x-api-key")).toBeNull();
		expect(mockState.headers?.get("authorization")).toBe("Bearer sk-ant-oat-test");
		const headers = mockState.headers!;
		expect(headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
	});

	it("lets explicit request headers override ANTHROPIC_AUTH_TOKEN", async () => {
		const models = createModels({
			authContext: {
				env: async (name) => (name === "ANTHROPIC_AUTH_TOKEN" ? "ctx-token" : undefined),
				fileExists: async () => false,
			},
		});
		models.setProvider(anthropicProvider());

		await models
			.streamSimple(anthropicModel, context, { headers: { Authorization: "Bearer explicit-token" } })
			.result();

		const headers = mockState.headers!;
		expect(headers.get("authorization")).toBe("Bearer explicit-token");
	});
});
