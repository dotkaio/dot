# Skills

Dot supports the [Agent Skills](https://agentskills.io) format. A skill is a directory containing `SKILL.md` with YAML frontmatter and instructions.

```markdown
---
name: review
description: Review code for correctness and maintainability
---

# Review

1. Inspect the relevant files.
2. Run focused checks.
3. Report concrete findings.
```

## Locations

Dot discovers skills from:

- `~/.dot/agent/skills/`
- `~/.agents/skills/`
- `.dot/skills/`
- `.agents/skills/`
- Installed [Dot packages](packages.md)

Invoke the example skill above with `/review`. Every skill uses its declared `name` directly as its slash command. Dot can also load a skill when its description matches the task.

Extension commands take precedence over skills, and skills take precedence over prompt templates when names collide. Built-in interactive commands are handled by the TUI first.

Use `--skill <path>` to load an explicit skill and `--no-skills` to disable discovery.
