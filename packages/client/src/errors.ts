import type { JsonValue, ProtocolError, ProtocolErrorCode } from "@dotkaio/dot-protocol";

export class DotServerError extends Error {
	readonly code: ProtocolErrorCode;
	readonly details: JsonValue | undefined;

	constructor(error: ProtocolError) {
		super(error.message);
		this.name = "DotServerError";
		this.code = error.code;
		this.details = error.details;
	}
}

export class DotDisconnectedError extends Error {
	constructor(message = "Dot client is disconnected") {
		super(message);
		this.name = "DotDisconnectedError";
	}
}

export class DotSessionDetachedError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`Session ${sessionId} is not attached`);
		this.name = "DotSessionDetachedError";
		this.sessionId = sessionId;
	}
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function toDisconnectedError(error: unknown): DotDisconnectedError {
	const cause = toError(error);
	return cause instanceof DotDisconnectedError ? cause : new DotDisconnectedError(cause.message);
}
