# Quickstart

This page gets you from install to a useful first dot session.

## Install

Dot is distributed as an npm package:

```bash
npm install -g --ignore-scripts @dotkaio/dot
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Dot does not require install scripts for normal npm installs.

### Uninstall

Use the package manager that installed dot. The curl installer uses npm globally, so curl and npm installs are removed with npm:

```bash
# curl installer or npm install -g
npm uninstall -g @dotkaio/dot

# pnpm
pnpm remove -g @dotkaio/dot

# Yarn
yarn global remove @dotkaio/dot

# Bun
bun uninstall -g @dotkaio/dot
```

Uninstalling dot leaves settings, credentials, sessions, and installed dot packages in `~/.dot/agent/`.

Then start dot in the project directory you want it to work on:

```bash
cd /path/to/project
dot
```

## Authenticate

Dot can use subscription providers through `/login`, or API-key providers through environment variables or the auth file.

### Option 1: subscription login

Start dot and run:

```text
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### Option 2: API key

Set an API key before launching dot:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
dot
```

You can also run `/login` and select an API-key provider to store the key in `~/.dot/agent/auth.json`.

See [Providers](providers.md) for all supported providers, environment variables, and cloud-provider setup.

## First session

Once dot starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default, dot gives the model four tools:

- `read` - read files
- `write` - create or overwrite files
- `edit` - patch files
- `bash` - run shell commands

Additional built-in read-only tools (`grep`, `find`, `ls`) are available through tool options. Dot runs in your current working directory and can modify files there. Use git or another checkpointing workflow if you want easy rollback.

## Give dot project instructions

Dot loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Dot loads:

- `~/.dot/agent/AGENTS.md` for global instructions
- `AGENTS.md` or `CLAUDE.md` from parent directories and the current directory

Restart dot, or run `/reload`, after changing context files.

## Common things to try

### Reference files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
dot @README.md "Summarize this"
dot @src/app.ts @src/app.test.ts "Review these together"
```

Images or text can be pasted with Ctrl+V (Alt+V on Windows); images can also be dragged into supported terminals.

### Run shell commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch models

Use `/model` or Ctrl+L to choose a model. Use Shift+Tab to cycle thinking level. Use Ctrl+P / Shift+Ctrl+P to cycle through scoped models.

### Continue later

Sessions are saved automatically:

```bash
dot -c                  # Continue most recent session
dot -r                  # Browse previous sessions
dot --name "my task"    # Set session display name at startup
dot --session <path|id> # Open a specific session
```

Inside dot, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-interactive mode

For one-shot prompts:

```bash
dot -p "Summarize this codebase"
cat README.md | dot -p "Summarize this text"
dot -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next steps

- [Using Dot](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [Dot Packages](packages.md) - install shared extensions, skills, prompts, and themes.

Platform notes: [Windows](windows.md), [Termux](termux.md), [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
