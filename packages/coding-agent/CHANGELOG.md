# Changelog

## [Unreleased]

### Changed

- The session selector now opens the global session list directly instead of starting with a current-folder scope.
- Assistant responses now target the current terminal row budget and are visually bounded when they exceed it, while preserving the full response in session data.
- The source launcher now uses Node's native TypeScript runtime and module compile cache to cut warm interactive startup time by roughly half.
- Extension events without listeners no longer allocate contexts on every streamed message update.

## [0.0.1] - 2026-08-07

### Added

- Initial `@dotkaio/dot` release.
