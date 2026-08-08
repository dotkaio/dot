# Environment Variables

Dot uses environment variables in three ways:

- Variables such as `DOT_OFFLINE` configure the Dot process.
- Dot sets `DOT_CODING_AGENT` so child processes can detect that they run inside Dot.
- Commands run by the LLM-callable bash tool receive `DOT_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#environment-variables-or-auth-file).

## Process Marker

The CLI and RPC entry points set `DOT_CODING_AGENT=true`. Child processes inherit it and can use it to detect that they run inside Dot. It is not session-specific and is not set automatically when Dot is embedded through the SDK.

## Bash Tool Session Environment

Commands run by the bash tool receive the current Dot session state:

| Variable | Description |
|----------|-------------|
| `DOT_SESSION_ID` | Current session ID |
| `DOT_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `DOT_PROVIDER` | Currently selected model provider |
| `DOT_MODEL` | Currently selected model ID |
| `DOT_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next bash command without restarting Dot. `DOT_PROVIDER` and `DOT_MODEL` identify the selected Dot model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$DOT_PROVIDER" "$DOT_MODEL"
printf 'reasoning=%s session=%s\n' "$DOT_REASONING_LEVEL" "$DOT_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$DOT_SESSION_FILE" ]; then
  tail -n 1 "$DOT_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable bash tool. They are not injected into user-entered `!` or `!!` commands.

### Custom Bash Tools

Bash tools created with `createBashTool()` expose the session environment by default when registered with Dot. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const bashTool = createBashTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, Dot removes inherited values for these variables so nested Dot processes do not expose stale parent-session metadata.

## Dot Process Configuration

These variables are read by Dot itself:

| Variable | Description |
|----------|-------------|
| `DOT_CODING_AGENT_DIR` | Override the config directory; default is `~/.dot/agent` |
| `DOT_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `DOT_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `DOT_OFFLINE` | Disable startup network operations, including update checks, package updates, and model-catalog refreshes |
| `DOT_SKIP_VERSION_CHECK` | Disable the npm package version check |
| `DOT_PROVIDER_ATTRIBUTION` | Override provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `DOT_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `DOT_SHARE_BASE_URL` | Override the base URL used by `/share` |
| `DOT_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and cloud-provider configuration are listed in [Providers](providers.md#environment-variables-or-auth-file).
