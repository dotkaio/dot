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

Invoke a skill with `/skill:name`. Dot can also load a skill when its description matches the task.

Use `--skill <path>` to load an explicit skill and `--no-skills` to disable discovery.
