# @dotkaio/dot-server

Experimental. This package is under active development and may change or be removed without notice. Its CLI, APIs, and behavior are not yet stable.

Server package for dot.

## CLI

```bash
server --help
```

## Session server core

The package also exports the new `DotServer` session server. This API is additive while the legacy child-process supervisor and `server` CLI are migrated.

```ts
import type { DotSessionBackend } from "@dotkaio/dot-server";
import { createUnixServer } from "@dotkaio/dot-server/unix";

const backend: DotSessionBackend = {
  async listSessions() {
    return storage.listSessions();
  },
  async listModels() {
    return modelRegistry.listModels();
  },
  async createSession(options) {
    return storage.createAndOpen(options);
  },
  async openSession(sessionId) {
    return storage.open(sessionId);
  },
};

const server = createUnixServer(backend, {
  token: process.env.DOT_SERVER_TOKEN!,
  path: "/tmp/dot/server.sock",
});
await server.start();
```

`DotServer` composes transport listeners through the `DotServerListener` interface. The Unix submodule exports the `createUnixListener()` building block and `createUnixServer()` preset, keeping the common case concise without coupling the primary server to Unix sockets. The listener uses authenticated, length-prefixed CBOR messages from `@dotkaio/dot-protocol`. It does not yet replace the legacy JSONL IPC control plane, child-process supervisor, standalone `server` CLI, or Radius presence integration.

## Transport testing

Custom transports can use `@dotkaio/dot-server/testing` for deterministic protocol conformance tests. It exports `createTestServer()`, `TestSessionBackend`, `ProtocolTestClient`, and the transport-neutral `WireChannel` contract. `connectUnixTestClient()` is provided for Unix transport tests.

## `dot-ai` protocol bridge

`@dotkaio/dot-ai` domain objects and `@dotkaio/dot-protocol` wire DTOs remain independent. This package owns their boundary and exports `toProtocolModelMetadata()`, `toProtocolAssistantMessage()`, `toProtocolUserMessage()`, and `toProtocolToolResultMessage()`.

The adapters reject invalid tool inputs, explicitly sanitize diagnostic details, and exhaustively handle closed `dot-ai` unions. The protocol mirrors `dot-ai` vocabulary such as `toolCall` and `toolUse` where the semantics are identical. Compile-time assertions cover shared thinking-level and model-input vocabularies. Tests encode adapter output through the protocol runtime schemas so incompatible changes fail in the bridging package.

## Legacy server migration

The existing IPC, supervisor, process management, persistence, and Radius modules remain available during migration. The new Unix session protocol supersedes the legacy socket framing and RPC proxy only after the coding-agent backend and CLI replacement have landed. Radius is presence and registration infrastructure, not a transport, and requires a separate integration with the new server lifecycle before the legacy supervisor can be removed.
