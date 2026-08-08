# Contributing to Dot

## Before opening an issue

- Search existing issues.
- Provide a minimal reproduction.
- Include the Dot version, operating system, terminal, provider, and relevant configuration.
- Remove credentials and private session content from logs.

Security issues must follow [SECURITY.md](SECURITY.md).

## Before opening a pull request

1. Read [AGENTS.md](AGENTS.md).
2. Keep core changes minimal; prefer extensions for workflow-specific behavior.
3. Add focused tests for behavior changes.
4. Run:

```bash
npm run check
./test.sh
```

5. Explain the problem, implementation, and validation in the pull request.

Do not include unrelated formatting, generated files, dependency updates, or lockfile changes. Dependency and lockfile changes require explicit review.

## Development setup

```bash
git clone https://github.com/dotkaio/dot.git
cd dot
npm install --ignore-scripts
./dot.sh
```

## Code standards

- Use TypeScript with erasable syntax.
- Avoid `any` unless no sound alternative exists.
- Keep public APIs small and documented.
- Use configurable keybindings instead of hardcoded input sequences.
- Never commit credentials, local configuration, sessions, or generated runtime output.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT license.
