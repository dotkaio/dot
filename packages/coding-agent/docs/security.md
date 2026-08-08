# Security

Dot runs with the permissions of the user who starts it. It is not a sandbox.

Project instructions, extensions, skills, packages, shell configuration, environment variables, and writable files can influence model actions or execute code. Review untrusted repositories before opening them and use a container, virtual machine, or operating-system sandbox when stronger isolation is required.

Dot prompts before loading project-local executable resources unless project trust has already been decided. See [Settings](settings.md#project-trust) for trust behavior.

Never paste credentials into prompts or commit `~/.dot/agent/auth.json`. Review exported sessions before sharing them because they can contain prompts, paths, tool output, and source code.

Report vulnerabilities according to the repository [security policy](../../../SECURITY.md).
