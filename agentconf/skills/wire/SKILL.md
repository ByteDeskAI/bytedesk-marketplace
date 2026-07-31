---
name: wire
description: Set up or repair the shared agent configuration — one instruction source at ~/.agents/AGENTS.md wired into every installed agent tool. Use when the user wants to stop hand-syncing CLAUDE.md and AGENTS.md, when `agentconf check` reports something broken, or after an editor has clobbered a managed symlink.
user-invokable: true
allowed-tools:
  - Bash
---

Always show the plan before changing anything:

```
agentconf wire --dry-run
```

Read it out, then apply with `agentconf wire`. Every replaced file is backed up alongside
itself as `<name>.bak.<timestamp>` — say where the backups are.

Two things to explain rather than let the user discover:

- **Mechanism differs per target and is not a style choice.** Claude Code gets an `@import`
  line, Codex instructions get a symlink, Codex policy gets a *copy* — because a symlinked
  `*.rules` file is silently ignored by Codex (openai/codex#16452). A copy can drift, which
  is why `check` compares them.
- **Per-tool sections survive.** The shared file holds what is genuinely common. Anything
  that names one tool's CLI stays in that tool's own file, below the import.

After wiring, run `agentconf check`. If the user wants proof the tools actually *read* it
rather than proof the files exist, that is [[verify]].
