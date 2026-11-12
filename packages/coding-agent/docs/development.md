# Development

See [AGENTS.md](https://github.com/dotkaio/dot/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/dotkaio/dot.git
cd dot
./dot.sh
```

No Node.js or npm install is required. The launcher downloads and verifies a prebuilt binary for your platform on first launch, or runs the TypeScript source directly with Node when dependencies are already installed. On Windows, run `dot.bat`. The launcher can be run by absolute path from any directory and keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "dotConfig": {
    "name": "dot",
    "configDir": ".dot"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.dot/agent/dot-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
