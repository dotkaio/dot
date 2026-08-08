import { afterEach, describe, expect, it, vi } from "vitest";
import { stream as streamGoogleGeminiCli } from "../src/api/google-gemini-cli.ts";
import type { Context, Model } from "../src/types.ts";

interface CloudCodeAssistPayload {
	project?: string;
	user_prompt_id?: string;
	request: {
		generationConfig?: Record<string, unknown>;
		session_id?: string;
		systemInstruction?: unknown;
	};
}

interface FetchInit {
	body?: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

function makeModel(): Model<"google-gemini-cli"> {
	return {
		id: "gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro Preview",
		api: "google-gemini-cli",
		provider: "google-gemini-cli",
		baseUrl: "https://cloudcode-pa.googleapis.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	};
}

describe("google-gemini-cli request payload", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps client-only abort signals out of generationConfig and sends systemInstruction as Content", async () => {
		const controller = new AbortController();
		let payload: CloudCodeAssistPayload | undefined;
		let requestInit: FetchInit | undefined;
		const responseBody = `data: ${JSON.stringify({
			response: {
				candidates: [
					{
						content: { parts: [{ text: "Hello" }] },
						finishReason: "STOP",
					},
				],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
			},
		})}\r\n\r\n`;

		const fetchMock = vi.fn(async (_input: unknown, init?: FetchInit) => {
			requestInit = init;
			expect(typeof init?.body).toBe("string");
			payload = JSON.parse(init?.body ?? "") as unknown as CloudCodeAssistPayload;
			return new Response(responseBody, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const context: Context = {
			systemPrompt: "You are concise.",
			messages: [{ role: "user", content: "hey", timestamp: Date.now() }],
		};

		const resultStream = streamGoogleGeminiCli(
			{
				...makeModel(),
				headers: { "x-goog-user-project": "sigma-arcade-x09p9", "X-Test-Header": "kept" },
			},
			context,
			{
				apiKey: "access-token",
				maxTokens: 12,
				temperature: 0,
				signal: controller.signal,
				sessionId: "session-123",
			},
		);
		for await (const _event of resultStream) {
			// consume stream
		}

		const result = await resultStream.result();
		expect(result.stopReason, result.errorMessage).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
		expect(requestInit?.signal).toBe(controller.signal);
		expect(requestInit?.headers?.["X-Goog-User-Project"]).toBeUndefined();
		expect(requestInit?.headers?.["x-goog-user-project"]).toBeUndefined();
		expect(requestInit?.headers?.["X-Test-Header"]).toBe("kept");
		expect(payload?.project).toBe("sigma-arcade-x09p9");
		expect(payload?.user_prompt_id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(payload?.request.session_id).toBe("session-123");
		expect(payload?.request.systemInstruction).toEqual({ parts: [{ text: "You are concise." }] });
		expect(payload?.request.generationConfig).toMatchObject({ maxOutputTokens: 12, temperature: 0 });
		expect(payload?.request.generationConfig).not.toHaveProperty("abortSignal");
		expect(payload?.request.generationConfig).not.toHaveProperty("systemInstruction");
		expect(payload?.request.generationConfig).not.toHaveProperty("tools");
		expect(payload?.request.generationConfig).not.toHaveProperty("toolConfig");
	});
});
