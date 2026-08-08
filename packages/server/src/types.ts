import type {
	Command,
	ModelMetadata,
	ModelRef,
	SessionPhase,
	SessionSnapshot,
	SessionSummary,
	ThinkingLevel,
	TranscriptProgress,
} from "@dotkaio/dot-protocol";
import type { DotServerError } from "./errors.ts";
import type { DotServerListener } from "./listener.ts";

export interface DotServerOptions {
	token: string;
	listeners: readonly DotServerListener[];
	maxFrameLength?: number;
	handshakeTimeoutMs?: number;
	serverId?: string;
	onError?: (error: Error) => void;
}

export type MaybePromise<T> = T | Promise<T>;

export type PromptInput = Omit<Extract<Command, { command: "prompt" }>, "command" | "sessionId">;
export type SteerInput = Omit<Extract<Command, { command: "steer" }>, "command" | "sessionId">;

export interface CreateSessionOptions {
	/** A collision-resistant ID assigned by DotServer. The backend must persist this exact ID. */
	id: string;
	cwd?: string;
	name?: string;
	model?: ModelRef;
	thinkingLevel?: ThinkingLevel;
}

export type DotSessionRuntimeEvent =
	| { type: "snapshot" }
	| { type: "progress"; progress: TranscriptProgress }
	| { type: "error"; error: DotServerError };

/** One acquired durable session. Conflicting operations must reject rather than queue. */
export interface DotSessionRuntime {
	snapshot(): MaybePromise<SessionSnapshot>;
	getPhase(): SessionPhase;
	prompt(input: PromptInput): Promise<void>;
	steer(input: SteerInput): Promise<void>;
	abort(): Promise<void>;
	setModel(model: ModelRef): Promise<void>;
	setThinking(thinkingLevel: ThinkingLevel): Promise<void>;
	subscribe(listener: (event: DotSessionRuntimeEvent) => void): () => void;
	dispose(): Promise<void>;
}

/** Durable storage and exclusively acquired runtime boundary. */
export interface DotSessionBackend {
	listSessions(): Promise<SessionSummary[]>;
	listModels(): Promise<ModelMetadata[]>;
	createSession(options: CreateSessionOptions): Promise<DotSessionRuntime>;
	openSession(sessionId: string): Promise<DotSessionRuntime>;
}

export type SessionRuntime = DotSessionRuntime;
export type SessionBackend = DotSessionBackend;
export type SessionRuntimeEvent = DotSessionRuntimeEvent;
