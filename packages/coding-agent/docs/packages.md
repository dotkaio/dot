> dot can help you create dot packages. Ask it to bundle your extensions, skills, prompt templates, or themes.

# Dot Packages

Dot packages bundle extensions, skills, prompt templates, and themes so you can share them through npm or git. A package can declare resources in `package.json` under the `dot` key, or use conventional directories.

## Table of Contents

- [Install and Manage](#install-and-manage)
- [Package Sources](#package-sources)
- [Creating a Dot Package](#creating-a-dot-package)
- [Package Structure](#package-structure)
- [Dependencies](#dependencies)
- [Package Filtering](#package-filtering)
- [Enable and Disable Resources](#enable-and-disable-resources)
- [Scope and Deduplication](#scope-and-deduplication)

## Install and Manage

> **Security:** Dot packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

```bash
dot install npm:@foo/bar@1.0.0
dot install git:github.com/user/repo@v1
dot install https://github.com/user/repo  # raw URLs work too
dot install /absolute/path/to/package
dot install ./relative/path/to/package

dot remove npm:@foo/bar
dot list                     # show installed packages from settings
dot update                   # update dot only
dot update --all             # update dot, update packages, and reconcile pinned git refs
dot update --extensions      # update packages and reconcile pinned git refs only
dot update --models          # refresh model catalogs only
dot update --self            # update dot only
dot update --self --force    # reinstall dot even if current
dot update npm:@foo/bar      # update one package
dot update --extension npm:@foo/bar
```

These commands manage dot packages and `dot update` can update the dot CLI installation. To uninstall dot itself, see [Quickstart](quickstart.md#uninstall).

By default, `install` and `remove` write to user settings (`~/.dot/agent/settings.json`). Use `-l` to write to project settings (`.dot/settings.json`) instead. Project settings can be shared with your team, and dot installs any missing packages automatically on startup after the project is trusted.

To try a package without installing it, use `--extension` or `-e`. This installs to a temporary directory for the current run only:

```bash
dot -e npm:@foo/bar
dot -e git:github.com/user/repo
```

## Package Sources

Dot accepts three source types in settings and `dot install`.

### npm

```
npm:@scope/pkg@1.2.3
npm:pkg
```

- Versioned specs are pinned and skipped by package updates (`dot update --extensions`, `dot update --all`).
- User installs go under `~/.dot/agent/npm/`.
- Project installs go under `.dot/npm/`.
- Set `npmCommand` in `settings.json` to pin npm package lookup and install operations to a specific wrapper command such as `mise` or `asdf`.

Example:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

### git

```
git:github.com/user/repo@v1
git:git@github.com:user/repo@v1
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

- Without `git:` prefix, only protocol URLs are accepted (`https://`, `http://`, `ssh://`, `git://`).
- With `git:` prefix, shorthand formats are accepted, including `github.com/user/repo` and `git@github.com:user/repo`.
- HTTPS and SSH URLs are both supported.
- SSH URLs use your configured SSH keys automatically (respects `~/.ssh/config`).
- For non-interactive runs (for example CI), you can set `GIT_TERMINAL_PROMPT=0` to disable credential prompts and set `GIT_SSH_COMMAND` (for example `ssh -o BatchMode=yes -o ConnectTimeout=5`) to fail fast.
- Refs are pinned tags or commits. `dot update --extensions` and `dot update --all` do not move them to newer refs, but they do reconcile an existing clone to the configured ref.
- Use `dot install git:host/user/repo@new-ref` to update settings and move an existing package to a new pinned ref.
- Cloned to `~/.dot/agent/git/<host>/<path>` (global) or `.dot/git/<host>/<path>` (project).
- When reconciliation changes the checkout, dot resets and cleans the clone, then runs `npm install` if `package.json` exists.

**SSH examples:**
```bash
# git@host:path shorthand (requires git: prefix)
dot install git:git@github.com:user/repo

# ssh:// protocol format
dot install ssh://git@github.com/user/repo

# With version ref
dot install git:git@github.com:user/repo@v1.0.0
```

### Local Paths

```
/absolute/path/to/package
./relative/path/to/package
```

Local paths point to files or directories on disk and are added to settings without copying. Relative paths are resolved against the settings file they appear in. If the path is a file, it loads as a single extension. If it is a directory, dot loads resources using package rules.

## Creating a Dot Package

Add a `dot` manifest to `package.json` or use conventional directories. Include the `dot-package` keyword for discoverability.

```json
{
  "name": "my-package",
  "keywords": ["dot-package"],
  "dot": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Paths are relative to the package root. Arrays support glob patterns and `!exclusions`.

### Discoverability

Add the `dot-package` keyword so users can find the package through npm search:

```bash
npm search keywords:dot-package
```

## Package Structure

### Convention Directories

If no `dot` manifest is present, dot auto-discovers resources from these directories:

- `extensions/` loads `.ts` and `.js` files
- `skills/` recursively finds `SKILL.md` folders and loads top-level `.md` files as skills
- `prompts/` loads `.md` files
- `themes/` loads `.json` files

## Dependencies

Third party runtime dependencies belong in `dependencies` in `package.json`. Dependencies that do not register extensions, skills, prompt templates, or themes also belong in `dependencies`. When dot installs a package from npm or git, it runs `npm install`, so those dependencies are installed automatically.

Dot bundles core packages for extensions and skills. If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them: `@dotkaio/dot-ai`, `@dotkaio/dot-agent-core`, `@dotkaio/dot-coding-agent`, `@dotkaio/dot-tui`, `typebox`.

Other dot packages must be bundled in your tarball. Add them to `dependencies` and `bundledDependencies`, then reference their resources through `node_modules/` paths. Dot loads packages with separate module roots, so separate installs do not collide or share modules.

Example:

```json
{
  "dependencies": {
    "shitty-extensions": "^1.0.1"
  },
  "bundledDependencies": ["shitty-extensions"],
  "dot": {
    "extensions": ["extensions", "node_modules/shitty-extensions/extensions"],
    "skills": ["skills", "node_modules/shitty-extensions/skills"]
  }
}
```

## Package Filtering

Filter what a package loads using the object form in settings:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

`+path` and `-path` are exact paths relative to the package root.

- Omit a key to load all of that type.
- Use `[]` to load none of that type.
- `!pattern` excludes matches.
- `+path` force-includes an exact path.
- `-path` force-excludes an exact path.
- Filters layer on top of the manifest. They narrow down what is already allowed.

## Enable and Disable Resources

Use `dot config` to enable or disable extensions, skills, prompt templates, and themes from installed packages and local directories. `dot config` starts in global settings (`~/.dot/agent/settings.json`); press Tab to switch between global and project-local modes. Use `dot config -l` to start in project overrides (`.dot/settings.json`) with inherited global resources dimmed.

## Scope and Deduplication

Packages can appear in both global and project settings. If the same package appears in both, the project entry wins unless the project entry has `autoload: false`, in which case it is applied as a delta over the global entry. Identity is determined by:

- npm: package name
- git: repository URL without ref
- local: resolved absolute path
