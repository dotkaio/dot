export type { DotSessionHandle } from "./client.ts";
export { DotClient } from "./client.ts";
export { DotDisconnectedError, DotServerError, DotSessionDetachedError } from "./errors.ts";
export type { ByteTransport, ByteTransportFactory, ByteTransportHandlers } from "./transport.ts";
export type {
	ConnectionState,
	ConnectionStateChange,
	CreateSessionOptions,
	DotClientOptions,
	ListenerErrorHandler,
	Unsubscribe,
} from "./types.ts";
