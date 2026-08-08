import type { ByteConnectionAcceptor } from "./connection.ts";

/** A transport listener that supplies ordered byte connections to DotServer. */
export interface DotServerListener {
	/** Human-readable bound address after startup, when the transport has one. */
	readonly address?: string;
	start(accept: ByteConnectionAcceptor): Promise<void>;
	close(): Promise<void>;
}
