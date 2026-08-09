# Dot

Dot is a terminal coding harness by [dotkaio](https://github.com/dotkaio). It supports interactive, print, JSON, RPC, server, and SDK workflows and can be extended with TypeScript extensions, skills, prompt templates, themes, and packages.

## Install

```bash
npm install -g --ignore-scripts @dotkaio/dot
dot
```

Authenticate with `/login`, select a model with `/model`, and start working.

See the [coding-agent README](packages/coding-agent/README.md) and [documentation](packages/coding-agent/docs/index.md).

## Packages

| Package | Description |
|---|---|
| [`@dotkaio/dot-ai`](packages/ai) | Multi-provider LLM API |
| [`@dotkaio/dot-agent-core`](packages/agent) | Agent runtime and harness |
| [`@dotkaio/dot-tui`](packages/tui) | Terminal UI library |
| [`@dotkaio/dot`](packages/coding-agent) | Dot CLI and SDK |
| [`@dotkaio/dot-protocol`](packages/protocol) | Client/server wire protocol |
| [`@dotkaio/dot-client`](packages/client) | Dot client library |
| [`@dotkaio/dot-server`](packages/server) | Dot server |
| [`@dotkaio/dot-storage-sqlite-node`](packages/storage/sqlite-node) | SQLite session storage |
| [`@dotkaio/dot-evals`](packages/evals) | Evaluation harness |

## Development

```bash
npm install --ignore-scripts
npm run check
./test.sh
./dot.sh
```

Use `npm run build:offline` to build from the checked-in model data, or `npm run build` to refresh provider metadata first.

## Swift

[`swift/CodexSlashCommands`](swift/CodexSlashCommands) is a standalone Swift package containing the complete documented Codex `/` command catalog, parser, autocomplete, and typed routing boundary. It lives alongside the TypeScript implementation and does not add a Node.js dependency to Swift targets.

## Security

Dot runs with the permissions of the user who starts it. Extensions and packages execute arbitrary code. Review third-party code and use an operating-system sandbox when stronger isolation is required. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).
