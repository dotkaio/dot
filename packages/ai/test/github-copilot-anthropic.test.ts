import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { getModel } from "../src/compat.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import type { Context } from "../src/types.ts";

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

describe("Copilot Claude via Anthropic Messages", () => {
	const context: Context = {
		systemPrompt: "You are a helpful assistant.",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	it("applies Copilot-specific adaptive thinking effort overrides", () => {
		const opus47 = getModel("github-copilot", "claude-opus-4.7");
		expect(opus47.thinkingLevelMap).toMatchObject({ minimal: "low", xhigh: "xhigh", max: "max" });
		expect(getSupportedThinkingLevels(opus47)).toContain("xhigh");
		expect(getSupportedThinkingLevels(opus47)).toContain("max");

		const opus5 = getModel("github-copilot", "claude-opus-5");
		expect(opus5.api).toBe("anthropic-messages");
		expect(opus5.contextWindow).toBe(1000000);
		expect(opus5.thinkingLevelMap).toMatchObject({ minimal: "low", xhigh: "xhigh", max: "max" });
		expect(getSupportedThinkingLevels(opus5)).toContain("xhigh");
		expect(getSupportedThinkingLevels(opus5)).toContain("max");

		const sonnet46 = getModel("github-copilot", "claude-sonnet-4.6");
		expect(sonnet46.thinkingLevelMap).toMatchObject({ minimal: "low", max: "max" });
		expect(getSupportedThinkingLevels(sonnet46)).toContain("max");
		expect(getSupportedThinkingLevels(sonnet46)).not.toContain("xhigh");
	});

	it("uses Bearer auth, Copilot headers, and valid Anthropic Messages payload", async () => {
		const model = getModel("github-copilot", "claude-sonnet-4.6");
		expect(model.api).toBe("anthropic-messages");

		const s = streamAnthropic(model, context, { apiKey: "tid_copilot_session_test_token" });
		for await (const event of s) {
			if (event.type === "error") break;
		}

		const headers = mockState.headers!;
		expect(headers).toBeDefined();

		expect(headers.get("x-api-key")).toBeNull();
		expect(headers.get("authorization")).toBe("Bearer tid_copilot_session_test_token");

		// Copilot static headers from model.headers
		expect(headers.get("User-Agent")).toContain("GitHubCopilotChat");
		expect(headers.get("Copilot-Integration-Id")).toBe("vscode-chat");

		// Dynamic headers
		expect(headers.get("X-Initiator")).toBe("user");
		expect(headers.get("Openai-Intent")).toBe("conversation-edits");

		// No fine-grained-tool-streaming (Copilot doesn't support it)
		const beta = headers.get("anthropic-beta") ?? "";
		expect(beta).not.toContain("fine-grained-tool-streaming");

		// Payload is valid Anthropic Messages format
		const params = mockState.createParams!;
		expect(params.model).toBe("claude-sonnet-4.6");
		expect(params.stream).toBe(true);
		expect(params.max_tokens).toBe(model.maxTokens);
		expect(Array.isArray(params.messages)).toBe(true);
	});

	it("omits interleaved-thinking beta for adaptive-thinking models", async () => {
		const model = getModel("github-copilot", "claude-sonnet-4.6");
		const s = streamAnthropic(model, context, {
			apiKey: "tid_copilot_session_test_token",
			interleavedThinking: true,
		});
		for await (const event of s) {
			if (event.type === "error") break;
		}

		const headers = mockState.headers!;
		expect(headers.get("anthropic-beta") ?? "").not.toContain("interleaved-thinking-2025-05-14");
	});
});
