# CodexSlashCommands

A standalone Swift package for the documented Codex `/` command surface. It can be integrated alongside Dot's existing TypeScript command system without adding a Node.js dependency to a native Swift target.

The catalog includes:

- 49 canonical Codex CLI commands and four aliases
- seven additional Codex IDE commands
- surface metadata for the seven commands documented in the ChatGPT desktop app
- platform and feature availability notes for conditional commands

In total, the parser recognizes 60 command names. The catalog is based on the official OpenAI Developer Commands reference as retrieved on 2026-08-08.

## Usage

```swift
import CodexSlashCommands

let parser = CodexSlashParser()
let invocation = try parser.parse("/goal Finish the migration")

switch invocation.command {
case .goal:
	print(invocation.arguments ?? "Show the current goal")
default:
	break
}
```

Use `CodexSlashCommandCatalog.suggestions(for:surface:)` to populate a `/` autocomplete menu. Implement `CodexSlashCommandHandling` and pass it to `CodexSlashRouter.route(_:to:)` to connect parsed invocations to application behavior.

The package deliberately leaves account access, session storage, UI presentation, sandbox changes, and other host-specific effects to the integrating application. It provides the complete command identity, metadata, parser, autocomplete, and routing boundary in Swift.

## Test

```bash
swift test --package-path swift/CodexSlashCommands
```

## Launch

```bash
swift run --package-path swift/CodexSlashCommands codex-slash
```

Pass `--surface cli`, `--surface desktop`, or `--surface ide` to filter the menu. Use `--list` to print the selected catalog without starting the interactive shell.
