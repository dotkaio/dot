# Changelog

## [Unreleased]

### Breaking Changes

- Skills are now invoked directly as `/name`; namespaced skill commands are no longer supported.

### Changed

- The session selector now opens the global session list directly instead of starting with a current-folder scope.
- Assistant responses now target the current terminal row budget and are visually bounded when they exceed it, while preserving the full response in session data.
- The source launcher now uses Node's native TypeScript runtime and module compile cache to cut warm interactive startup time by roughly half.
- Extension events without listeners no longer allocate contexts on every streamed message update.

### Added

- `ctrl+h` toggles full assistant output, showing rows normally omitted to fit the terminal.
- Runtime policies can lock an installation to one model, disable built-in commands, equivalent hotkeys, and built-in extensions, replace the footer identity label, and present a clean time-aware startup greeting.
- Built-in `web_search` and `web_fetch` tools provide live, citable Keenable research with keyless defaults and optional API-key authentication.

### Fixed

- Vercel AI Gateway remaining balance now refreshes when its API key is stored through `/login` instead of exported in the shell environment.

## [0.0.1] - 2026-08-07

### Added

- Initial `@dotkaio/dot` release.
