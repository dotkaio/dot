import Foundation

/// Codex surfaces that expose slash commands.
public enum CodexSurface: String, CaseIterable, Sendable {
	case cli
	case desktopApp
	case ideExtension
}

/// Canonical command names documented across Codex developer surfaces.
public enum CodexSlashCommand: String, CaseIterable, Sendable {
	case agent
	case approve
	case app
	case apps
	case archive
	case clear
	case cloud
	case cloudEnvironment = "cloud-environment"
	case compact
	case copy
	case debugConfig = "debug-config"
	case delete
	case diff
	case experimental
	case fast
	case feedback
	case fork
	case goal
	case hooks
	case ide
	case ideContext = "ide-context"
	case importCommand = "import"
	case initCommand = "init"
	case keymap
	case local
	case logout
	case mcp
	case memories
	case mention
	case model
	case new
	case permissions
	case personality
	case pets
	case plan
	case plugins
	case project
	case ps
	case quit
	case raw
	case reasoning
	case rename
	case resume
	case review
	case sandboxAddReadDirectory = "sandbox-add-read-dir"
	case setupDefaultSandbox = "setup-default-sandbox"
	case side
	case skills
	case status
	case statusline
	case stop
	case theme
	case title
	case usage
	case vim
	case worktree
}

/// User-facing metadata for one canonical slash command.
public struct CodexSlashCommandDefinition: Equatable, Sendable {
	public let command: CodexSlashCommand
	public let summary: String
	public let argumentHint: String?
	public let aliases: [String]
	public let surfaces: Set<CodexSurface>
	public let availability: String?

	public init(
		command: CodexSlashCommand,
		summary: String,
		argumentHint: String? = nil,
		aliases: [String] = [],
		surfaces: Set<CodexSurface>,
		availability: String? = nil
	) {
		self.command = command
		self.summary = summary
		self.argumentHint = argumentHint
		self.aliases = aliases
		self.surfaces = surfaces
		self.availability = availability
	}

	public var name: String {
		command.rawValue
	}

	public var invocation: String {
		"/\(name)"
	}

	public var recognizedNames: [String] {
		[name] + aliases
	}
}

/// Complete documented Codex slash-command catalog.
public enum CodexSlashCommandCatalog {
	public static let commands: [CodexSlashCommandDefinition] = [
		entry(.agent, "Switch the active agent thread.", hint: "[thread]", aliases: ["subagents"], surfaces: [.cli]),
		entry(
			.approve,
			"Approve one retry of a recent automatic-review denial.",
			surfaces: [.cli, .ideExtension],
			availability: "Available when automatic review has denied a recent action."
		),
		entry(
			.app,
			"Continue the current session in the ChatGPT desktop app.",
			surfaces: [.cli],
			availability: "Available on macOS and Windows when the desktop app is installed."
		),
		entry(.apps, "Browse apps and insert one into the prompt.", surfaces: [.cli]),
		entry(.archive, "Archive the current session and exit Codex.", surfaces: [.cli]),
		entry(.clear, "Clear the terminal and start a fresh chat.", surfaces: [.cli]),
		entry(
			.cloud,
			"Run the chat in the cloud.",
			surfaces: [.ideExtension],
			availability: "Available when cloud execution is enabled."
		),
		entry(
			.cloudEnvironment,
			"Choose the cloud environment for the chat.",
			surfaces: [.ideExtension],
			availability: "Available when cloud execution is enabled."
		),
		entry(.compact, "Summarize the current chat to free context tokens.", surfaces: [.cli, .ideExtension]),
		entry(.copy, "Copy the latest completed Codex output.", surfaces: [.cli]),
		entry(.debugConfig, "Print configuration layers and requirements diagnostics.", surfaces: [.cli]),
		entry(.delete, "Permanently delete the current session and exit Codex.", surfaces: [.cli]),
		entry(.diff, "Show the Git diff, including untracked files.", surfaces: [.cli]),
		entry(.experimental, "Toggle experimental features.", surfaces: [.cli]),
		entry(
			.fast,
			"Toggle the model's Fast service tier.",
			surfaces: [.cli, .ideExtension],
			availability: "Available when the active model advertises a Fast tier."
		),
		entry(
			.feedback,
			"Submit feedback and optionally include diagnostics.",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(.fork, "Fork the current chat into a new chat.", surfaces: [.cli, .ideExtension]),
		entry(
			.goal,
			"Set, edit, pause, resume, view, or clear the task goal.",
			hint: "[objective|edit|pause|resume|clear]",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(.hooks, "View and manage lifecycle hooks.", surfaces: [.cli]),
		entry(
			.ide,
			"Include open files, the current selection, and other IDE context.",
			surfaces: [.cli],
			availability: "Available when Codex is connected to a supported IDE."
		),
		entry(.ideContext, "Toggle automatic IDE context.", surfaces: [.ideExtension]),
		entry(.importCommand, "Import supported external-agent setup, projects, and chats.", surfaces: [.cli]),
		entry(
			.initCommand,
			"Generate an AGENTS.md scaffold for the current project.",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(.keymap, "Inspect and persist TUI keyboard shortcut bindings.", surfaces: [.cli]),
		entry(.local, "Run the chat in the local workspace.", surfaces: [.ideExtension]),
		entry(.logout, "Sign out and clear local credentials.", surfaces: [.cli]),
		entry(
			.mcp,
			"Show configured Model Context Protocol servers and tools.",
			hint: "[verbose]",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(
			.memories,
			"Configure memory use and generation.",
			surfaces: [.cli, .ideExtension],
			availability: "Available when Memories is enabled."
		),
		entry(.mention, "Attach a file or folder to the chat.", hint: "<path>", surfaces: [.cli]),
		entry(
			.model,
			"Choose the active model and reasoning effort when available.",
			hint: "[model]",
			surfaces: [.cli, .ideExtension]
		),
		entry(.new, "Start a new chat in the current CLI session.", surfaces: [.cli]),
		entry(.permissions, "Set what Codex can do without asking first.", surfaces: [.cli]),
		entry(
			.personality,
			"Choose the response communication style.",
			hint: "[friendly|pragmatic|none]",
			surfaces: [.cli, .ideExtension],
			availability: "Available when the active model supports personalities."
		),
		entry(.pets, "Choose or hide a terminal pet.", aliases: ["pet"], surfaces: [.cli]),
		entry(
			.plan,
			"Switch to plan mode and optionally send a planning prompt.",
			hint: "[prompt]",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(.plugins, "Browse and manage installed or discoverable plugins.", surfaces: [.cli]),
		entry(.project, "Choose a project for new chats.", surfaces: [.ideExtension]),
		entry(.ps, "Show background terminals and their recent output.", surfaces: [.cli]),
		entry(.quit, "Exit the Codex CLI.", aliases: ["exit"], surfaces: [.cli]),
		entry(.raw, "Toggle raw terminal scrollback mode.", surfaces: [.cli]),
		entry(.reasoning, "Choose the reasoning effort for the current chat.", surfaces: [.ideExtension]),
		entry(.rename, "Rename the current chat.", hint: "[name]", surfaces: [.cli]),
		entry(.resume, "Resume a saved chat from the session list.", surfaces: [.cli]),
		entry(
			.review,
			"Start a review of the current working tree.",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(
			.sandboxAddReadDirectory,
			"Grant the sandbox read access to another directory.",
			hint: "<absolute-path>",
			surfaces: [.cli],
			availability: "Windows only."
		),
		entry(
			.setupDefaultSandbox,
			"Set up the elevated default agent sandbox.",
			surfaces: [.cli],
			availability: "Windows only."
		),
		entry(
			.side,
			"Start an ephemeral side chat.",
			hint: "[prompt]",
			aliases: ["btw"],
			surfaces: [.cli, .ideExtension]
		),
		entry(.skills, "Browse and use skills.", surfaces: [.cli]),
		entry(
			.status,
			"Show session configuration, context use, and rate limits.",
			surfaces: [.cli, .desktopApp, .ideExtension]
		),
		entry(.statusline, "Configure the TUI status-line fields.", surfaces: [.cli]),
		entry(.stop, "Stop all background terminals for the session.", surfaces: [.cli]),
		entry(.theme, "Choose a terminal syntax-highlighting theme.", surfaces: [.cli]),
		entry(.title, "Configure terminal window or tab title fields.", surfaces: [.cli]),
		entry(.usage, "View account token usage or use a rate-limit reset.", surfaces: [.cli]),
		entry(.vim, "Toggle Vim mode for the composer.", surfaces: [.cli]),
		entry(.worktree, "Run the chat in a new Git worktree.", surfaces: [.ideExtension]),
	]

	private static let definitionsByName: [String: CodexSlashCommandDefinition] = {
		var definitions: [String: CodexSlashCommandDefinition] = [:]
		for definition in commands {
			for name in definition.recognizedNames {
				definitions[name] = definition
			}
		}
		return definitions
	}()

	public static var recognizedNames: [String] {
		definitionsByName.keys.sorted()
	}

	public static func definition(for command: CodexSlashCommand) -> CodexSlashCommandDefinition {
		guard let definition = commands.first(where: { $0.command == command }) else {
			preconditionFailure("Missing slash-command definition for /\(command.rawValue)")
		}
		return definition
	}

	public static func resolve(_ name: String) -> CodexSlashCommandDefinition? {
		definitionsByName[normalize(name)]
	}

	public static func commands(for surface: CodexSurface) -> [CodexSlashCommandDefinition] {
		commands.filter { $0.surfaces.contains(surface) }
	}

	public static func suggestions(
		for query: String,
		surface: CodexSurface? = nil,
		limit: Int = 10
	) -> [CodexSlashCommandDefinition] {
		let normalizedQuery = normalize(query)
		let candidates = surface.map { commands(for: $0) } ?? commands
		let ranked = candidates.compactMap { definition -> (Int, CodexSlashCommandDefinition)? in
			if normalizedQuery.isEmpty {
				return (0, definition)
			}

			let names = definition.recognizedNames
			if definition.name.hasPrefix(normalizedQuery) {
				return (0, definition)
			}
			if names.contains(where: { $0.hasPrefix(normalizedQuery) }) {
				return (1, definition)
			}
			if names.contains(where: { $0.contains(normalizedQuery) }) {
				return (2, definition)
			}
			if normalizedQuery.count >= 3 {
				let maximumDistance = normalizedQuery.count >= 7 ? 2 : 1
				if names.contains(where: { editDistance($0, normalizedQuery) <= maximumDistance }) {
					return (3, definition)
				}
			}
			return nil
		}

		return ranked
			.sorted {
				if $0.0 != $1.0 {
					return $0.0 < $1.0
				}
				return $0.1.name < $1.1.name
			}
			.prefix(max(0, limit))
			.map { $0.1 }
	}

	private static func entry(
		_ command: CodexSlashCommand,
		_ summary: String,
		hint: String? = nil,
		aliases: [String] = [],
		surfaces: Set<CodexSurface>,
		availability: String? = nil
	) -> CodexSlashCommandDefinition {
		CodexSlashCommandDefinition(
			command: command,
			summary: summary,
			argumentHint: hint,
			aliases: aliases,
			surfaces: surfaces,
			availability: availability
		)
	}

	private static func normalize(_ value: String) -> String {
		let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return trimmed.hasPrefix("/") ? String(trimmed.dropFirst()) : trimmed
	}

	private static func editDistance(_ first: String, _ second: String) -> Int {
		let firstCharacters = Array(first)
		let secondCharacters = Array(second)
		var previousRow = Array(0 ... secondCharacters.count)

		for (firstIndex, firstCharacter) in firstCharacters.enumerated() {
			var currentRow = [firstIndex + 1]
			for (secondIndex, secondCharacter) in secondCharacters.enumerated() {
				let insertion = currentRow[secondIndex] + 1
				let deletion = previousRow[secondIndex + 1] + 1
				let substitution = previousRow[secondIndex] + (firstCharacter == secondCharacter ? 0 : 1)
				currentRow.append(min(insertion, deletion, substitution))
			}
			previousRow = currentRow
		}

		return previousRow[secondCharacters.count]
	}
}
