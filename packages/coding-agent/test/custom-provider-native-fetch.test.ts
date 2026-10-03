import type { Api, Model } from "@dotkaio/dot-ai";
import { expect, it, vi } from "vitest";
import { streamSimple } from "../../ai/src/api/anthropic-messages.ts";
import registerCustomAnthropic from "../examples/extensions/custom-provider-anthropic/index.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";

// Exercise current source even when this checkout still has older dist artifacts.
vi.mock("@dotkaio/dot-ai/api/anthropic-messages", () => ({
	streamSimple: (...args: Parameters<typeof streamSimple>) => streamSimple(...args),
}));

it("streams the custom provider example without an SDK and preserves its identity", async () => {
	const registerProvider = vi.fn<ExtensionAPI["registerProvider"]>();
	registerCustomAnthropic({ registerProvider } as unknown as ExtensionAPI);
	const [id, config] = registerProvider.mock.calls[0];
	expect(id).toBe("custom-anthropic");
	expect(config.oauth?.name).toBe("Custom Anthropic (Claude Pro/Max)");
	const model: Model<Api> = {
		...config.models![0],
		api: "custom-anthropic-api",
		provider: id,
		baseUrl: config.baseUrl!,
	};
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(
			new Response(
				[
					{ type: "message_start", message: { id: "test", usage: { input_tokens: 1, output_tokens: 0 } } },
					{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
					{ type: "message_stop" },
				]
					.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
					.join(""),
			),
		);
	const result = await config.streamSimple!(
		model,
		{
			messages: [{ role: "user", content: "test", timestamp: 0 }],
		},
		{ apiKey: "local-test-key", fetch },
	).result();
	expect(result.stopReason).toBe("stop");
	expect(result.api).toBe("custom-anthropic-api");
	expect(result.provider).toBe(id);
	const payload = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as Record<string, unknown>;
	expect(payload.max_tokens).toBe(Math.floor(model.maxTokens / 3));
});
