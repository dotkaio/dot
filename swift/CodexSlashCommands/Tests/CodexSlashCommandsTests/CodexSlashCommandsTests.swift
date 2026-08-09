import XCTest
@testable import CodexSlashCommands

final class CodexSlashCommandsTests: XCTestCase {
	func testCatalogContainsEveryDocumentedCommandAndAlias() {
		let expectedNames: Set<String> = [
			"agent", "subagents", "approve", "app", "apps", "archive", "clear", "cloud",
			"cloud-environment", "compact", "copy", "debug-config", "delete", "diff", "experimental",
			"fast", "feedback", "fork", "goal", "hooks", "ide", "ide-context", "import", "init",
			"keymap", "local", "logout", "mcp", "memories", "mention", "model", "new", "permissions",
			"personality", "pets", "pet", "plan", "plugins", "project", "ps", "quit", "exit", "raw",
			"reasoning", "rename", "resume", "review", "sandbox-add-read-dir", "setup-default-sandbox",
			"side", "btw", "skills", "status", "statusline", "stop", "theme", "title", "usage", "vim",
			"worktree",
		]

		XCTAssertEqual(Set(CodexSlashCommandCatalog.recognizedNames), expectedNames)
		XCTAssertEqual(CodexSlashCommandCatalog.commands.count, 56)
		XCTAssertEqual(CodexSlashCommandCatalog.recognizedNames.count, 60)
	}

	func testEveryEnumCaseHasExactlyOneDefinition() {
		XCTAssertEqual(Set(CodexSlashCommandCatalog.commands.map(\.command)), Set(CodexSlashCommand.allCases))
		XCTAssertEqual(
			Set(CodexSlashCommandCatalog.commands.map(\.name)).count,
			CodexSlashCommandCatalog.commands.count
		)
	}

	func testSurfaceCatalogsMatchDocumentedCounts() {
		XCTAssertEqual(CodexSlashCommandCatalog.commands(for: .cli).count, 49)
		XCTAssertEqual(CodexSlashCommandCatalog.commands(for: .desktopApp).count, 7)
		XCTAssertEqual(CodexSlashCommandCatalog.commands(for: .ideExtension).count, 22)
	}

	func testParserCanonicalizesAliasesAndPreservesArguments() throws {
		let parser = CodexSlashParser()

		XCTAssertEqual(
			try parser.parse(" /subagents worker-2 "),
			CodexSlashInvocation(command: .agent, submittedName: "subagents", arguments: "worker-2")
		)
		XCTAssertEqual(
			try parser.parse("/btw Check this edge case"),
			CodexSlashInvocation(command: .side, submittedName: "btw", arguments: "Check this edge case")
		)
		XCTAssertEqual(
			try parser.parse("/exit"),
			CodexSlashInvocation(command: .quit, submittedName: "exit")
		)
		XCTAssertEqual(
			try parser.parse("/pet"),
			CodexSlashInvocation(command: .pets, submittedName: "pet")
		)
	}

	func testParserReportsUsefulErrors() {
		let parser = CodexSlashParser()

		XCTAssertThrowsError(try parser.parse("model")) { error in
			XCTAssertEqual(error as? CodexSlashParseError, .missingSlash)
		}
		XCTAssertThrowsError(try parser.parse("/statuz")) { error in
			guard let parseError = error as? CodexSlashParseError,
				case let .unknownCommand(name, suggestions) = parseError
			else {
				return XCTFail("Expected unknownCommand, received \(error)")
			}
			XCTAssertEqual(name, "statuz")
			XCTAssertTrue(suggestions.contains("/status"))
		}
	}

	func testSuggestionsResolveAliasesAndFilterBySurface() {
		XCTAssertEqual(
			CodexSlashCommandCatalog.suggestions(for: "/sub").map(\.command),
			[.agent]
		)
		XCTAssertEqual(
			CodexSlashCommandCatalog.suggestions(for: "cloud", surface: .cli).map(\.command),
			[]
		)
		XCTAssertEqual(
			CodexSlashCommandCatalog.suggestions(for: "cloud", surface: .ideExtension).map(\.command),
			[.cloud, .cloudEnvironment]
		)
	}
}
