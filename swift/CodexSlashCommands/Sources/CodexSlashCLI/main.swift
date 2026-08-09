import CodexSlashCommands
import Foundation

private enum CommandScope: String {
	case all
	case cli
	case desktop
	case ide

	var surface: CodexSurface? {
		switch self {
		case .all:
			return nil
		case .cli:
			return .cli
		case .desktop:
			return .desktopApp
		case .ide:
			return .ideExtension
		}
	}
}

private func parseScope(from arguments: [String]) -> CommandScope {
	guard let scopeIndex = arguments.firstIndex(of: "--surface"), arguments.indices.contains(scopeIndex + 1) else {
		return .all
	}
	return CommandScope(rawValue: arguments[scopeIndex + 1].lowercased()) ?? .all
}

private func definitions(for scope: CommandScope) -> [CodexSlashCommandDefinition] {
	let commands = scope.surface.map { CodexSlashCommandCatalog.commands(for: $0) }
		?? CodexSlashCommandCatalog.commands
	return commands.sorted { $0.name < $1.name }
}

private func printCatalog(scope: CommandScope, query: String = "") {
	let commands: [CodexSlashCommandDefinition]
	if query.isEmpty {
		commands = definitions(for: scope)
	} else {
		commands = CodexSlashCommandCatalog.suggestions(for: query, surface: scope.surface, limit: 60)
	}

	for definition in commands {
		let aliases = definition.aliases.isEmpty ? "" : " (aliases: \(definition.aliases.map { "/\($0)" }.joined(separator: ", ")))"
		let hint = definition.argumentHint.map { " \($0)" } ?? ""
		let label = "\(definition.invocation)\(hint)\(aliases)"
		print("\(label.padding(toLength: 48, withPad: " ", startingAt: 0)) \(definition.summary)")
	}

	if commands.isEmpty {
		print("No matching slash commands.")
	}
}

private func printInvocation(_ invocation: CodexSlashInvocation) {
	let definition = invocation.definition
	print("\n\(definition.invocation): \(definition.summary)")
	if let arguments = invocation.arguments {
		print("Arguments: \(arguments)")
	}
	if let availability = definition.availability {
		print("Availability: \(availability)")
	}
	print("Host action ready for dispatch.\n")
}

private func writePrompt() {
	FileHandle.standardOutput.write(Data("> ".utf8))
}

private let arguments = Array(CommandLine.arguments.dropFirst())
private let scope = parseScope(from: arguments)

if arguments.contains("--list") {
	printCatalog(scope: scope)
	exit(EXIT_SUCCESS)
}

print("Codex Slash Commands — Swift")
print("60 documented command names · surface: \(scope.rawValue)")
print("Type / to list commands, a partial name such as /sta to search, or /quit to exit.\n")

let parser = CodexSlashParser()
while true {
	writePrompt()
	guard let input = readLine() else {
		break
	}

	let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
	if trimmed == "/" {
		printCatalog(scope: scope)
		continue
	}
	if trimmed.hasPrefix("/"), !trimmed.dropFirst().contains(where: { $0.isWhitespace }),
		CodexSlashCommandCatalog.resolve(trimmed) == nil
	{
		printCatalog(scope: scope, query: trimmed)
		continue
	}

	do {
		let invocation = try parser.parse(trimmed)
		switch invocation.command {
		case .quit:
			print("Exiting.")
			exit(EXIT_SUCCESS)
		case .clear:
			print("\u{001B}[2J\u{001B}[H", terminator: "")
		default:
			printInvocation(invocation)
		}
	} catch let error as CodexSlashParseError {
		print(error.description)
	} catch {
		print("Unable to parse command: \(error)")
	}
}
