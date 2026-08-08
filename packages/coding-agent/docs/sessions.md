# Sessions

Dot saves persistent sessions as JSONL under `~/.dot/agent/sessions/`, grouped by working directory. Start with `--no-session` for an ephemeral run.

## Commands

- `/new` starts a new session.
- `/resume` opens the session selector.
- `/tree` navigates the current session tree.
- `/fork` creates a branch from an earlier user message.
- `/clone` copies the active branch into a new session file.
- `/compact` summarizes older context.
- `/name` sets a session title.

Use `dot --resume` to select a session at startup, or `dot --session <path>` to open an explicit file.

## Branching

A session is a tree. Forking preserves the existing branch and creates a new path from the selected entry. Tree navigation changes the active leaf without deleting history.

## Storage and portability

Session files can contain prompts, model output, tool arguments, tool results, paths, and environment-derived data. Review them before sharing. Use `/export` for a standalone HTML export or `/share` to create a private GitHub gist.

For entry schemas and APIs, see [Session format](session-format.md). For compaction behavior, see [Compaction](compaction.md).
