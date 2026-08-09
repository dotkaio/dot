import Foundation

public struct CodexSlashInvocation: Equatable, Sendable {
	public let command: CodexSlashCommand
	public let submittedName: String
	public let arguments: String?

	public init(command: CodexSlashCommand, submittedName: String, arguments: String? = nil) {
		self.command = command
		self.submittedName = submittedName
		self.arguments = arguments
	}

	public var definition: CodexSlashCommandDefinition {
		CodexSlashCommandCatalog.definition(for: command)
	}
}

public enum CodexSlashParseError: Error, Equatable, Sendable {
	case emptyInput
	case missingSlash
	case missingCommand
	case unknownCommand(name: String, suggestions: [String])
}

extension CodexSlashParseError: CustomStringConvertible {
	public var description: String {
		switch self {
		case .emptyInput:
			return "Slash-command input is empty."
		case .missingSlash:
			return "Slash commands must start with '/'."
		case .missingCommand:
			return "Enter a command after '/'."
		case let .unknownCommand(name, suggestions):
			if suggestions.isEmpty {
				return "Unknown slash command '/\(name)'."
			}
			return "Unknown slash command '/\(name)'. Try \(suggestions.joined(separator: ", "))."
		}
	}
}

public struct CodexSlashParser: Sendable {
	public init() {}

	public func parse(_ input: String) throws -> CodexSlashInvocation {
		let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else {
			throw CodexSlashParseError.emptyInput
		}
		guard trimmed.hasPrefix("/") else {
			throw CodexSlashParseError.missingSlash
		}

		let body = trimmed.dropFirst()
		guard !body.isEmpty else {
			throw CodexSlashParseError.missingCommand
		}

		let commandEnd = body.firstIndex(where: { $0.isWhitespace }) ?? body.endIndex
		let submittedName = body[..<commandEnd].lowercased()
		guard !submittedName.isEmpty else {
			throw CodexSlashParseError.missingCommand
		}

		guard let definition = CodexSlashCommandCatalog.resolve(submittedName) else {
			let suggestions = CodexSlashCommandCatalog
				.suggestions(for: submittedName, limit: 3)
				.map(\.invocation)
			throw CodexSlashParseError.unknownCommand(name: submittedName, suggestions: suggestions)
		}

		let rawArguments = String(body[commandEnd...]).trimmingCharacters(in: .whitespacesAndNewlines)
		return CodexSlashInvocation(
			command: definition.command,
			submittedName: submittedName,
			arguments: rawArguments.isEmpty ? nil : rawArguments
		)
	}
}

/// A host implements command effects while this package owns parsing and command identity.
public protocol CodexSlashCommandHandling {
	associatedtype Output

	func handle(_ invocation: CodexSlashInvocation) async throws -> Output
}

public struct CodexSlashRouter: Sendable {
	public let parser: CodexSlashParser

	public init(parser: CodexSlashParser = CodexSlashParser()) {
		self.parser = parser
	}

	public func route<Handler: CodexSlashCommandHandling>(
		_ input: String,
		to handler: Handler
	) async throws -> Handler.Output {
		try await handler.handle(parser.parse(input))
	}
}
