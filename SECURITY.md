# Security Policy

Dot is a local coding harness that runs with the permissions of the user who starts it. It is not a security sandbox.

## Reporting a vulnerability

Report security issues privately through [GitHub Security Advisories](https://github.com/dotkaio/dot/security/advisories/new).

Include:

- A concise description and impact
- Reproduction steps or a proof of concept
- The affected package, version, and commit
- Relevant logs with credentials removed
- Known mitigations

Do not open a public issue for an undisclosed vulnerability.

## In scope

- Privilege-boundary violations caused by Dot
- Vulnerabilities in published `@dotkaio` packages
- Credential disclosure caused by Dot without prior local compromise
- Remote code execution through supported remote inputs without user-approved execution
- Vulnerabilities in repository-owned release and update mechanisms

## Out of scope

- Prompt injection
- Actions explicitly requested or approved by the user
- Malicious extensions, skills, packages, models, or repositories
- Reports requiring prior write access to the user's files, environment, shell configuration, or `~/.dot`
- Public exposure caused by user configuration
- Denial-of-service claims requiring trusted local input
- Vulnerabilities in third-party services that Dot merely connects to

## Trust model

Treat project instructions, extensions, skills, packages, shell configuration, environment variables, and writable files as trusted code. Use a container, virtual machine, or operating-system sandbox when working with untrusted material.
