/** Wire shapes used by the Messages adapter; no provider SDK is required. */
export interface CacheControlEphemeral {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

export type ContentBlockParam = (
	| { type: "text"; text: string }
	| {
			type: "image";
			source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
	  }
	| { type: "thinking"; thinking: string; signature: string }
	| { type: "redacted_thinking"; data: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| {
			type: "tool_result";
			tool_use_id: string;
			content: string | Array<ContentBlockParam | { type: "tool_reference"; tool_name: string }>;
			is_error?: boolean;
	  }
) & { cache_control?: CacheControlEphemeral };

export interface MessageParam {
	role: "user" | "assistant";
	content: string | ContentBlockParam[];
}

export interface WireTool {
	name: string;
	description?: string;
	input_schema: { type: "object"; properties: unknown; required: string[] };
	eager_input_streaming?: boolean;
	strict?: boolean;
	defer_loading?: boolean;
	cache_control?: CacheControlEphemeral;
}

export interface MessageCreateParamsStreaming {
	model: string;
	messages: MessageParam[];
	max_tokens: number;
	stream: true;
	system?: Array<Extract<ContentBlockParam, { type: "text" }>>;
	temperature?: number;
	tools?: WireTool[];
	thinking?: { type: "adaptive" | "enabled" | "disabled"; budget_tokens?: number; display?: "summarized" | "omitted" };
	output_config?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
	metadata?: { user_id: string };
	tool_choice?: { type: "auto" | "any" | "none" } | { type: "tool"; name: string };
}

export interface RefusalStopDetails {
	type: "refusal";
	category?: string | null;
	explanation?: string | null;
}

interface WireUsage {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
	cache_creation?: { ephemeral_1h_input_tokens?: number } | null;
	output_tokens_details?: { thinking_tokens?: number };
}

export type RawMessageStreamEvent =
	| { type: "message_start"; message: { id: string; usage: WireUsage } }
	| {
			type: "message_delta";
			delta: { stop_reason?: string | null; stop_details?: RefusalStopDetails | null };
			usage?: WireUsage;
	  }
	| { type: "message_stop" }
	| { type: "content_block_start"; index: number; content_block: ContentBlockParam }
	| {
			type: "content_block_delta";
			index: number;
			delta:
				| { type: "text_delta"; text: string }
				| { type: "thinking_delta"; thinking: string }
				| { type: "input_json_delta"; partial_json: string }
				| { type: "signature_delta"; signature: string }
				| { type: "citations_delta"; citation: unknown };
	  }
	| { type: "content_block_stop"; index: number };

/** Minimal client injection contract for alternate Messages endpoints. */
export interface AnthropicMessagesClient {
	messages: {
		create(
			params: MessageCreateParamsStreaming,
			options: { signal?: AbortSignal; timeout?: number; maxRetries: number },
		): { asResponse(): Promise<Response> };
	};
}
