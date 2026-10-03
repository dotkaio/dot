import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stream } from "../src/api/anthropic-messages.ts";
import type { Context, Model } from "../src/types.ts";

const model: Model<"anthropic-messages"> = {
	id: "test-model",
	name: "Test",
	api: "anthropic-messages",
	provider: "test-provider",
	baseUrl: "https://provider.invalid/prefix/",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 1024,
};
const context: Context = { messages: [{ role: "user", content: "hello", timestamp: 0 }] };
const body = [
	{ type: "message_start", message: { id: "msg_http", usage: { input_tokens: 3, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "hello" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
	{ type: "message_stop" },
]
	.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
	.join("");

afterEach(() => vi.useRealTimers());

describe("native Messages HTTP transport", () => {
	it("streams over real HTTP with a base path, API auth, and payload callbacks", async () => {
		let receivedPath: string | undefined;
		let receivedKey: string | undefined;
		let receivedVersion: string | undefined;
		let receivedPayload: Record<string, unknown> | undefined;
		const server = createServer(async (request, response) => {
			receivedPath = request.url;
			receivedKey = request.headers["x-api-key"] as string;
			receivedVersion = request.headers["anthropic-version"] as string;
			let payload = "";
			for await (const chunk of request) payload += String(chunk);
			receivedPayload = JSON.parse(payload) as Record<string, unknown>;
			response.writeHead(200, { "content-type": "text/event-stream", "x-request-id": "local-test" });
			response.write(body.slice(0, 30));
			response.end(body.slice(30));
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing test server port");
			const onResponse = vi.fn();
			const result = await stream(
				{ ...model, baseUrl: `http://127.0.0.1:${address.port}/proxy/?tenant=local` },
				context,
				{
					apiKey: "local-test-key",
					onPayload: (payload) => ({ ...(payload as Record<string, unknown>), max_tokens: 12 }),
					onResponse,
				},
			).result();
			expect(result.stopReason).toBe("stop");
			expect(result.content).toEqual([{ type: "text", text: "hello" }]);
			expect(receivedPath).toBe("/proxy/v1/messages?tenant=local");
			expect(receivedKey).toBe("local-test-key");
			expect(receivedVersion).toBe("2023-06-01");
			expect(receivedPayload).toMatchObject({ model: model.id, stream: true, max_tokens: 12 });
			expect(onResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 200,
					headers: expect.objectContaining({ "x-request-id": "local-test" }),
				}),
				expect.anything(),
			);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});

	it("merges headers case-insensitively and suppresses defaults with null", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
		const result = await stream({ ...model, headers: { Authorization: "Bearer model-token" } }, context, {
			apiKey: "local-test-key",
			headers: { authorization: "Bearer request-token", "X-Api-Key": null, "Anthropic-Version": null },
			fetch,
		}).result();
		expect(result.stopReason).toBe("stop");
		const headers = new Headers(fetch.mock.calls[0][1]?.headers);
		expect(headers.get("authorization")).toBe("Bearer request-token");
		expect(headers.has("x-api-key")).toBe(false);
		expect(headers.has("anthropic-version")).toBe(false);
	});

	it("retries rate limits using response retry headers", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after-ms": "0" } }))
			.mockResolvedValueOnce(new Response(body));
		const result = await stream(model, context, { apiKey: "test", fetch, maxRetries: 1 }).result();
		expect(result.stopReason).toBe("stop");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("does not retry authentication failures", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("invalid key", { status: 401 }));
		const result = await stream(model, context, { apiKey: "test", fetch, maxRetries: 2 }).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("401 invalid key");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("times out a pending request and clears its timer", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				}),
		);
		const resultPromise = stream(model, context, { apiKey: "test", fetch, timeoutMs: 10 }).result();
		await vi.advanceTimersByTimeAsync(10);
		const result = await resultPromise;
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Request timed out");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("aborts a pending request without retrying", async () => {
		const controller = new AbortController();
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				}),
		);
		const resultPromise = stream(model, context, {
			apiKey: "test",
			fetch,
			signal: controller.signal,
			maxRetries: 2,
		}).result();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		controller.abort();
		expect((await resultPromise).stopReason).toBe("aborted");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
