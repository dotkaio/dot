import type { Content, GenerateContentConfig, GenerateContentResponse, Part, ThinkingConfig } from "@google/genai";
import { calculateCost, clampThinkingLevel } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingBudgets,
	ThinkingContent,
	ThinkingLevel,
	ToolCall,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import type { GoogleThinkingLevel } from "./google-shared.ts";
import {
	convertMessages,
	convertTools,
	isThinkingPart,
	mapStopReason,
	mapToolChoice,
	retainThoughtSignature,
} from "./google-shared.ts";
import { buildBaseOptions } from "./simple-options.ts";

export interface GoogleGeminiCliOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
		level?: GoogleThinkingLevel;
	};
}

type GenerateContentParameters = {
	model: string;
	contents: unknown;
	config?: GenerateContentConfig;
};

type CloudCodeAssistGenerationConfig = Omit<
	GenerateContentConfig,
	"abortSignal" | "systemInstruction" | "tools" | "toolConfig"
>;

type CloudCodeAssistRequest = {
	model: string;
	project: string;
	user_prompt_id: string;
	request: {
		contents: unknown;
		generationConfig?: CloudCodeAssistGenerationConfig;
		session_id?: string;
		systemInstruction?: Content;
		tools?: ReturnType<typeof convertTools>;
		toolConfig?: GenerateContentConfig["toolConfig"];
	};
};

type FetchResponse = {
	ok: boolean;
	status: number;
	statusText: string;
	body: AsyncIterable<Uint8Array> | null;
	text(): Promise<string>;
};

type CloudCodeAssistStreamChunk = GenerateContentResponse & {
	response?: GenerateContentResponse;
};

type SseBoundary = {
	index: number;
	length: number;
};

type GoogleEffort = Exclude<ThinkingLevel, "xhigh" | "max">;

let toolCallCounter = 0;

export const stream: StreamFunction<"google-gemini-cli", GoogleGeminiCliOptions> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: GoogleGeminiCliOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "google-gemini-cli" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) throw new Error(`No OAuth access token for provider: ${model.provider}`);

			let params = buildParams(model, context, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) params = nextParams as GenerateContentParameters;
			const googleStream = streamGenerateContent(model, params, apiKey, options);

			stream.push({ type: "start", partial: output });
			let currentBlock: TextContent | ThinkingContent | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;

			for await (const chunk of googleStream) {
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text !== undefined) {
							const isThinking = isThinkingPart(part);
							if (
								!currentBlock ||
								(isThinking && currentBlock.type !== "thinking") ||
								(!isThinking && currentBlock.type !== "text")
							) {
								if (currentBlock) {
									if (currentBlock.type === "text") {
										stream.push({
											type: "text_end",
											contentIndex: blockIndex(),
											content: currentBlock.text,
											partial: output,
										});
									} else {
										stream.push({
											type: "thinking_end",
											contentIndex: blockIndex(),
											content: currentBlock.thinking,
											partial: output,
										});
									}
								}
								if (isThinking) {
									currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
									output.content.push(currentBlock);
									stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
								} else {
									currentBlock = { type: "text", text: "" };
									output.content.push(currentBlock);
									stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
								}
							}
							if (currentBlock.type === "thinking") {
								currentBlock.thinking += part.text;
								currentBlock.thinkingSignature = retainThoughtSignature(
									currentBlock.thinkingSignature,
									part.thoughtSignature,
								);
								stream.push({
									type: "thinking_delta",
									contentIndex: blockIndex(),
									delta: part.text,
									partial: output,
								});
							} else {
								currentBlock.text += part.text;
								currentBlock.textSignature = retainThoughtSignature(
									currentBlock.textSignature,
									part.thoughtSignature,
								);
								stream.push({
									type: "text_delta",
									contentIndex: blockIndex(),
									delta: part.text,
									partial: output,
								});
							}
						}

						if (part.functionCall) {
							if (currentBlock) {
								if (currentBlock.type === "text") {
									stream.push({
										type: "text_end",
										contentIndex: blockIndex(),
										content: currentBlock.text,
										partial: output,
									});
								} else {
									stream.push({
										type: "thinking_end",
										contentIndex: blockIndex(),
										content: currentBlock.thinking,
										partial: output,
									});
								}
								currentBlock = null;
							}
							const providedId = part.functionCall.id;
							const needsNewId =
								!providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
							const toolCallId = needsNewId
								? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
								: providedId;
							const toolCall: ToolCall = {
								type: "toolCall",
								id: toolCallId,
								name: part.functionCall.name || "",
								arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
								...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
							};
							output.content.push(toolCall);
							stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							stream.push({
								type: "toolcall_delta",
								contentIndex: blockIndex(),
								delta: JSON.stringify(toolCall.arguments),
								partial: output,
							});
							stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
						}
					}
				}

				if (candidate?.finishReason) {
					output.rawStopReason = candidate.finishReason;
					output.stopReason = mapStopReason(candidate.finishReason);
					if (output.content.some((b) => b.type === "toolCall")) output.stopReason = "toolUse";
				}

				if (chunk.usageMetadata) {
					output.usage = {
						input:
							(chunk.usageMetadata.promptTokenCount || 0) - (chunk.usageMetadata.cachedContentTokenCount || 0),
						output:
							(chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
						cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
						cacheWrite: 0,
						reasoning: chunk.usageMetadata.thoughtsTokenCount || 0,
						totalTokens: chunk.usageMetadata.totalTokenCount || 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
					calculateCost(model, output.usage);
				}
			}

			if (currentBlock) {
				if (currentBlock.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex: blockIndex(),
						content: currentBlock.text,
						partial: output,
					});
				} else {
					stream.push({
						type: "thinking_end",
						contentIndex: blockIndex(),
						content: currentBlock.thinking,
						partial: output,
					});
				}
			}
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "pending") throw new Error("Google Gemini CLI stream ended without a finish reason");
			if (output.stopReason === "aborted" || output.stopReason === "error") {
				const errorMessage = output.rawStopReason
					? `Provider stopped with: ${output.rawStopReason}`
					: "An unknown error occurred";
				throw new Error(errorMessage);
			}
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimple: StreamFunction<"google-gemini-cli", SimpleStreamOptions> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey;
	if (!apiKey) throw new Error(`No OAuth access token for provider: ${model.provider}`);
	const base = buildBaseOptions(model, context, options, apiKey);
	if (!options?.reasoning)
		return stream(model, context, { ...base, thinking: { enabled: false } } satisfies GoogleGeminiCliOptions);

	const clampedReasoning = clampThinkingLevel(model, options.reasoning);
	const effort = toGoogleEffort(clampedReasoning);
	if (isGemini3ProModel(model) || isGemini3FlashModel(model)) {
		return stream(model, context, {
			...base,
			thinking: { enabled: true, level: getThinkingLevel(effort, model) },
		} satisfies GoogleGeminiCliOptions);
	}
	return stream(model, context, {
		...base,
		thinking: { enabled: true, budgetTokens: getGoogleBudget(model, effort, options.thinkingBudgets) },
	} satisfies GoogleGeminiCliOptions);
};

async function* streamGenerateContent(
	model: Model<"google-gemini-cli">,
	params: GenerateContentParameters,
	accessToken: string,
	options?: GoogleGeminiCliOptions,
): AsyncGenerator<GenerateContentResponse> {
	const headers = providerHeadersToRecord({ ...model.headers, ...options?.headers }) ?? {};
	const requestHeaders = { ...headers };
	const projectId = takeHeader(requestHeaders, "X-Goog-User-Project");
	if (!projectId) throw new Error("Google Gemini CLI OAuth credentials are missing projectId");
	const generationConfig = toCloudCodeAssistGenerationConfig(params.config);
	const systemInstruction = toCloudCodeAssistSystemInstruction(params.config?.systemInstruction);
	const request: CloudCodeAssistRequest = {
		model: params.model,
		project: projectId,
		user_prompt_id: crypto.randomUUID(),
		request: {
			contents: params.contents,
			...(generationConfig && { generationConfig }),
			...(options?.sessionId && { session_id: options.sessionId }),
			...(systemInstruction && { systemInstruction }),
			...(params.config?.tools && { tools: params.config.tools as ReturnType<typeof convertTools> }),
			...(params.config?.toolConfig && { toolConfig: params.config.toolConfig }),
		},
	};

	const response = (await fetch(
		`${model.baseUrl ?? "https://cloudcode-pa.googleapis.com"}/v1internal:streamGenerateContent?alt=sse`,
		{
			method: "POST",
			headers: {
				...requestHeaders,
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				"User-Agent": "google-api-nodejs-client/9.15.1",
				"X-Goog-Api-Client": "gl-node/22.19.0",
			},
			body: JSON.stringify(request),
			signal: options?.signal,
		},
	)) as unknown as FetchResponse;
	if (!response.ok)
		throw new Error(
			`Google Gemini CLI request failed: ${response.status} ${response.statusText}: ${await response.text()}`,
		);
	if (!response.body) throw new Error("Google Gemini CLI response missing body");

	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of response.body) {
		buffer += decoder.decode(chunk, { stream: true });
		let boundary = findSseBoundary(buffer);
		while (boundary) {
			const event = buffer.slice(0, boundary.index);
			buffer = buffer.slice(boundary.index + boundary.length);
			const payload = event
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (payload && payload !== "[DONE]") {
				const chunk = JSON.parse(payload) as CloudCodeAssistStreamChunk;
				yield chunk.response ?? chunk;
			}
			boundary = findSseBoundary(buffer);
		}
	}
}

function takeHeader(headers: Record<string, string>, expectedName: string): string | undefined {
	const lowerExpectedName = expectedName.toLowerCase();
	let value: string | undefined;
	for (const [name, headerValue] of Object.entries(headers)) {
		if (name.toLowerCase() !== lowerExpectedName) continue;
		value = headerValue;
		delete headers[name];
	}
	return value;
}

function findSseBoundary(buffer: string): SseBoundary | undefined {
	const lf = buffer.indexOf("\n\n");
	const crlf = buffer.indexOf("\r\n\r\n");
	if (lf < 0 && crlf < 0) return undefined;
	if (lf < 0) return { index: crlf, length: 4 };
	if (crlf < 0) return { index: lf, length: 2 };
	return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function toCloudCodeAssistGenerationConfig(
	config: GenerateContentConfig | undefined,
): CloudCodeAssistGenerationConfig | undefined {
	if (!config) return undefined;

	const generationConfig: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config) as [keyof GenerateContentConfig, unknown][]) {
		if (key === "abortSignal" || key === "systemInstruction" || key === "tools" || key === "toolConfig") continue;
		generationConfig[key] = value;
	}

	if (Object.keys(generationConfig).length === 0) return undefined;
	return generationConfig as CloudCodeAssistGenerationConfig;
}

function toCloudCodeAssistSystemInstruction(
	systemInstruction: GenerateContentConfig["systemInstruction"] | undefined,
): Content | undefined {
	if (systemInstruction === undefined) return undefined;
	if (typeof systemInstruction === "string") return { parts: [{ text: sanitizeSurrogates(systemInstruction) }] };
	if (Array.isArray(systemInstruction)) return { parts: systemInstruction.map(toCloudCodeAssistPart) };
	if (isContent(systemInstruction)) {
		return {
			...systemInstruction,
			...(systemInstruction.parts && { parts: systemInstruction.parts.map(toCloudCodeAssistPart) }),
		};
	}
	return { parts: [toCloudCodeAssistPart(systemInstruction)] };
}

function toCloudCodeAssistPart(part: Part | string): Part {
	if (typeof part === "string") return { text: sanitizeSurrogates(part) };
	if (part.text === undefined) return part;
	return { ...part, text: sanitizeSurrogates(part.text) };
}

function isContent(value: Content | Part): value is Content {
	return "parts" in value || "role" in value;
}

function buildParams(
	model: Model<"google-gemini-cli">,
	context: Context,
	options: GoogleGeminiCliOptions = {},
): GenerateContentParameters {
	const contents = convertMessages(model, context);
	const config: GenerateContentConfig = {
		...(options.temperature !== undefined && { temperature: options.temperature }),
		...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
		...(context.systemPrompt && { systemInstruction: sanitizeSurrogates(context.systemPrompt) }),
		...(context.tools && context.tools.length > 0 && { tools: convertTools(context.tools) }),
	};
	if (context.tools && context.tools.length > 0 && options.toolChoice) {
		config.toolConfig = { functionCallingConfig: { mode: mapToolChoice(options.toolChoice) } };
	}
	if (options.thinking?.enabled && model.reasoning) {
		const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
		if (options.thinking.level !== undefined) thinkingConfig.thinkingLevel = options.thinking.level;
		else if (options.thinking.budgetTokens !== undefined)
			thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		config.thinkingConfig = thinkingConfig as ThinkingConfig;
	} else if (model.reasoning && options.thinking && !options.thinking.enabled) {
		config.thinkingConfig = getDisabledThinkingConfig(model);
	}
	if (options.signal) {
		if (options.signal.aborted) throw new Error("Request aborted");
		config.abortSignal = options.signal;
	}
	return { model: model.id, contents, config };
}

function isGemini3ProModel(model: Model<"google-gemini-cli">): boolean {
	return /gemini-3(?:\.\d+)?-pro/.test(model.id.toLowerCase());
}

function isGemini3FlashModel(model: Model<"google-gemini-cli">): boolean {
	const id = model.id.toLowerCase();
	return /gemini-3(?:\.\d+)?-flash/.test(id) || id === "gemini-flash-latest" || id === "gemini-flash-lite-latest";
}

function getDisabledThinkingConfig(model: Model<"google-gemini-cli">): ThinkingConfig {
	if (isGemini3ProModel(model)) return { thinkingLevel: "LOW" } as ThinkingConfig;
	if (isGemini3FlashModel(model)) return { thinkingLevel: "MINIMAL" } as ThinkingConfig;
	return { thinkingBudget: 0 };
}

function toGoogleEffort(effort: ThinkingLevel | "off"): GoogleEffort {
	switch (effort) {
		case "minimal":
		case "low":
		case "medium":
		case "high":
			return effort;
		case "off":
		case "xhigh":
		case "max":
			return "high";
	}
}

function getThinkingLevel(effort: GoogleEffort, model: Model<"google-gemini-cli">): GoogleThinkingLevel {
	if (isGemini3ProModel(model)) return effort === "high" || effort === "medium" ? "HIGH" : "LOW";
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}

function getGoogleBudget(
	model: Model<"google-gemini-cli">,
	effort: GoogleEffort,
	customBudgets?: ThinkingBudgets,
): number {
	if (customBudgets?.[effort] !== undefined) return customBudgets[effort]!;
	if (model.id.includes("2.5-pro")) return { minimal: 128, low: 2048, medium: 8192, high: 32768 }[effort];
	if (model.id.includes("2.5-flash")) return { minimal: 128, low: 2048, medium: 8192, high: 24576 }[effort];
	return -1;
}
