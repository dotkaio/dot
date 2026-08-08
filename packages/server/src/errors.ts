import type { JsonValue, ProtocolErrorCode } from "@dotkaio/dot-protocol";

export type DotServerOperationErrorCode = Extract<
	ProtocolErrorCode,
	"busy" | "session_locked" | "not_found" | "invalid_request"
>;

/** A backend/runtime error that can safely cross the protocol boundary. */
export class DotServerError extends Error {
	readonly code: DotServerOperationErrorCode;
	readonly details: JsonValue | undefined;

	constructor(code: DotServerOperationErrorCode, message: string, details?: JsonValue) {
		super(message);
		this.name = "DotServerError";
		this.code = code;
		this.details = details;
	}
}

export class SessionBusyError extends DotServerError {
	constructor(message = "Session is busy", details?: JsonValue) {
		super("busy", message, details);
		this.name = "SessionBusyError";
	}
}

export class SessionLockedError extends DotServerError {
	constructor(message = "Session is locked", details?: JsonValue) {
		super("session_locked", message, details);
		this.name = "SessionLockedError";
	}
}

export class SessionNotFoundError extends DotServerError {
	constructor(message = "Session was not found", details?: JsonValue) {
		super("not_found", message, details);
		this.name = "SessionNotFoundError";
	}
}
