# Changelog

## [Unreleased]

### Breaking Changes

- Skills are now invoked directly as `/name`; namespaced skill commands are no longer supported.

### Changed

- Source launchers now install locked dependencies automatically on first run, so a fresh clone can start with `./dot.sh` or `dot.bat` and update itself with the standard `update` command.
- The model picker adapts its columns and visible rows to the terminal, keeping IQ visible and moving extra metadata into the selected model's details. The IQ sort shortcut is shown beside the current sort mode.
- The model selector now shows provider-consistent IQ scores from Artificial Analysis's full Intelligence Index dataset, including deprecated models. Published v4.3 results fill gaps with a `*` marker; models without published scores show `N/A`.
- Model-picker metadata now refreshes in the background on independent chronological schedules: hourly Vercel pricing and release metadata, daily IQ data, and 15-minute retries after failures. Last-known-good data is persisted and reused across sessions.
- The TUI footer now shows only context usage and thinking by default; optional spend, Codex weekly, session cost, provider, and model values are configurable under Footer display settings.
- The TUI footer now shows cumulative tracked spend across all AI providers, including Vercel AI Gateway usage.
- The session selector now opens the global session list directly instead of starting with a current-folder scope.
- Assistant responses now target the current terminal row budget and are visually bounded when they exceed it, while preserving the full response in session data.
- The source launcher now uses Node's native TypeScript runtime and module compile cache to cut warm interactive startup time by roughly half.
- Extension events without listeners no longer allocate contexts on every streamed message update.
- The grep tool runs ripgrep with `--no-config`, so ambient user configuration like `RIPGREP_CONFIG_PATH` can no longer change the tool's contract.

### Added

- Muse (Meta Model API) provider with `muse-spark-*` models is available from `/login` using a Meta API key (`MODEL_API_KEY` or `META_API_KEY`).
- `ctrl+h` toggles full assistant output, showing rows normally omitted to fit the terminal.
- Runtime policies can lock an installation to one model, disable built-in commands, equivalent hotkeys, and built-in extensions, replace the footer identity label, and present a clean time-aware startup greeting.
- Built-in `web_search` and `web_fetch` tools provide live, citable Keenable research with keyless defaults and optional API-key authentication.

### Fixed

- Resuming or importing a session no longer waits for automatic title generation to finish.
- Model searches retain the selected sort order, catalog refreshes preserve the highlighted model, and Page Up/Down navigate the visible rows. Cached model details remain visible after refresh failures.
- Model IQ parsing now handles split Next.js data and keeps usable scores during failed or rate-limited refreshes. Cached scores appear immediately when opening the picker.
- Vercel AI Gateway remaining balance now refreshes when its API key is stored through `/login` instead of exported in the shell environment.
- The grep tool no longer reports the match limit when exactly that many matches exist, and the find tool no longer reports the result limit when exactly that many files match; a limit below 1 now means 1 instead of matching nothing.
- The grep tool takes context lines from ripgrep itself instead of reading every matched file into memory, which previously ran out of memory on large files. Custom `GrepOperations.readFile` callbacks are no longer called for context lines; the field remains accepted as optional and deprecated.
- The grep tool now matches globs relative to the searched `path`: with `path: "repo"` and `glob: "migrations/main/*.js"`, `repo/migrations/main/a.js` is found. A leading `./` in a glob is ignored instead of matching nothing.
- The bash tool no longer reports only `Command timed out` when the command had already exited but a background process it started kept writing to its output until the timeout. The error now also reports the shell's exit code and when it exited.
- Truncating long tool-output lines no longer cuts an emoji or other non-BMP character in half, which left an invalid lone surrogate in the text.
- Prompt template arguments no longer drop apostrophes and merge words: an apostrophe inside a word, as in `doesn't`, no longer opens a quote; a quote with no closing match is kept as text; and `\"` inside `"..."` (or `\'` inside `'...'`) gives a literal quote.

## [0.0.1] - 2026-08-07

### Added

- Initial `@dotkaio/dot` release.
