// swift-tools-version: 6.0

import PackageDescription

let package = Package(
	name: "CodexSlashCommands",
	platforms: [
		.macOS(.v13),
		.iOS(.v16),
	],
	products: [
		.library(name: "CodexSlashCommands", targets: ["CodexSlashCommands"]),
		.executable(name: "codex-slash", targets: ["CodexSlashCLI"]),
	],
	targets: [
		.target(name: "CodexSlashCommands"),
		.executableTarget(name: "CodexSlashCLI", dependencies: ["CodexSlashCommands"]),
		.testTarget(name: "CodexSlashCommandsTests", dependencies: ["CodexSlashCommands"]),
	],
)
