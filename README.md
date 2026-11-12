# Dot

Dot is a terminal coding harness by [dotkaio](https://github.com/dotkaio). It supports interactive, print, JSON, RPC, server, and SDK workflows and can be extended with TypeScript extensions, skills, prompt templates, themes, and packages.

## Install

```bash
npm install -g --ignore-scripts @dotkaio/dot
dot
```

Authenticate with `/login`, select a model with `/model`, and start working.

### Run from a clone

No Node.js or npm install required. On first launch the launcher downloads and verifies a prebuilt binary for macOS, Linux, or Windows from the latest [GitHub release](https://github.com/dotkaio/dot/releases). When dependencies are already installed locally, it runs the TypeScript source directly with Node instead.

```bash
git clone https://github.com/dotkaio/dot.git
cd dot
./dot.sh        # macOS / Linux
dot.bat         # Windows
```

The launcher preserves the directory it was invoked from, so it can be called by absolute path from any project.

See the [coding-agent README](packages/coding-agent/README.md) and [documentation](packages/coding-agent/docs/index.md).

## Packages

| Package | Description |
|---|---|
| [`@dotkaio/dot-ai`](packages/ai) | Multi-provider LLM API |
| [`@dotkaio/dot-agent-core`](packages/agent) | Agent runtime and harness |
| [`@dotkaio/dot-tui`](packages/tui) | Terminal UI library |
| [`@dotkaio/dot`](packages/coding-agent) | Dot CLI and SDK |
| [`@dotkaio/dot-keenable-web-search`](packages/keenable-web-search) | Built-in live web search and page fetch tools |
| [`@dotkaio/dot-protocol`](packages/protocol) | Client/server wire protocol |
| [`@dotkaio/dot-client`](packages/client) | Dot client library |
| [`@dotkaio/dot-server`](packages/server) | Dot server |
| [`@dotkaio/dot-storage-sqlite-node`](packages/storage/sqlite-node) | SQLite session storage |
| [`@dotkaio/dot-evals`](packages/evals) | Evaluation harness |

## Development

```bash
./dot.sh
npm run check
./test.sh
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
