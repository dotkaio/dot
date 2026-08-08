import type { AssistantMessage, Model } from "@dotkaio/dot-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import {
	GROQ_SESSION_TITLE_MODEL,
	generateAutomaticSessionTitle,
	generateSessionTitleFromSource,
	hasEnoughSessionTitleContext,
	type SessionTitleSource,
} from "../src/core/session-title.ts";

const groqModel: Model<"openai-completions"> = {
	id: GROQ_SESSION_TITLE_MODEL.id,
	name: "GPT OSS 20B",
	api: "openai-completions",
	provider: GROQ_SESSION_TITLE_MODEL.provider,
	baseUrl: "https://api.groq.com/openai/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 131_072,
	maxTokens: 65_536,
};

function assistantMessage(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: groqModel.api,
		provider: groqModel.provider,
		model: groqModel.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function source(...userMessages: string[]): SessionTitleSource {
	return {
		cwd: "/tmp/dot",
		messages: userMessages.map((text) => ({ role: "user", text })),
	};
}

function modelRuntime(options?: { configured?: boolean; response?: AssistantMessage }): {
	runtime: ModelRuntime;
	completeSimple: ReturnType<typeof vi.fn>;
} {
	const completeSimple = vi.fn(async () => options?.response ?? assistantMessage("Automatic OAuth Token Refresh"));
	return {
		runtime: {
			getModel: vi.fn(() => groqModel),
			hasConfiguredAuth: vi.fn(() => options?.configured ?? true),
			completeSimple,
		} as unknown as ModelRuntime,
		completeSimple,
	};
}

describe("automatic session titles", () => {
	let previousOffline: string | undefined;

	beforeEach(() => {
		previousOffline = process.env.DOT_OFFLINE;
		delete process.env.DOT_OFFLINE;
	});

	afterEach(() => {
		if (previousOffline === undefined) delete process.env.DOT_OFFLINE;
		else process.env.DOT_OFFLINE = previousOffline;
	});

	it("waits until the user supplies a meaningful topic", () => {
		expect(hasEnoughSessionTitleContext(source("hello"))).toBe(false);
		expect(hasEnoughSessionTitleContext(source("fix OAuth token refresh handling"))).toBe(true);
	});

	it("uses the configured Groq free-plan model and title prompt", async () => {
		const { runtime, completeSimple } = modelRuntime();
		const title = await generateAutomaticSessionTitle(source("fix OAuth token refresh handling"), runtime);

		expect(title).toBe("Automatic OAuth Token Refresh");
		expect(completeSimple).toHaveBeenCalledTimes(1);
		expect(completeSimple.mock.calls[0]?.[0]).toBe(groqModel);
		expect(completeSimple.mock.calls[0]?.[1]).toMatchObject({
			messages: [{ role: "user" }],
		});
		expect(completeSimple.mock.calls[0]?.[2]).toMatchObject({
			maxRetries: 0,
			reasoning: "low",
		});
	});

	it("falls back locally when Groq auth is unavailable", async () => {
		const { runtime, completeSimple } = modelRuntime({ configured: false });
		const title = await generateAutomaticSessionTitle(
			source("please configure the Vercel deployment for JuryScan custom domains"),
			runtime,
		);

		expect(title).toBe("Configure Vercel Deployment JuryScan Custom");
		expect(completeSimple).not.toHaveBeenCalled();
	});

	it("prefers recent meaningful user turns when the topic changes", () => {
		const title = generateSessionTitleFromSource(
			source("explain the history of the Roman republic", "fix iMessage skill permissions on macOS"),
		);
		expect(title).toBe("Fix iMessage Skill Permissions macOS");
	});

	it("rejects failed Groq responses and keeps a useful local title", async () => {
		const { runtime } = modelRuntime({ response: assistantMessage("", "error") });
		const title = await generateAutomaticSessionTitle(source("debug automatic session title generation"), runtime);
		expect(title).toBe("Debug Automatic Title Generation");
	});
});
