import { DotServer } from "../server.ts";
import type { DotServerOptions, DotSessionBackend } from "../types.ts";
import { TEST_TOKEN, TestSessionBackend } from "./backend.ts";

export interface TestServerOptions extends Omit<DotServerOptions, "token"> {
	token?: string;
	backend?: DotSessionBackend;
}

export interface TestServer {
	server: DotServer;
	backend: DotSessionBackend;
}

/** Create an unstarted DotServer with deterministic defaults for transport conformance tests. */
export function createTestServer(options: TestServerOptions): TestServer {
	const backend = options.backend ?? new TestSessionBackend();
	return {
		server: new DotServer(backend, {
			token: options.token ?? TEST_TOKEN,
			listeners: options.listeners,
			maxFrameLength: options.maxFrameLength,
			handshakeTimeoutMs: options.handshakeTimeoutMs,
			serverId: options.serverId,
			onError: options.onError,
		}),
		backend,
	};
}
