---
name: verify
description: Prove that each agent tool actually reads the shared instruction file, using a canary token rather than assuming the write landed. Use when a tool seems to be ignoring its instructions, after adding a new adapter, or when the user asks whether their rules are really in effect.
user-invokable: true
allowed-tools:
  - Bash
---

```
agentconf verify --all
```

This is the point of the whole tool. Writing a config file is not evidence that anything read
it: rulesync will happily write `~/.config/goose/.goosehints`, and `strings $(command -v goose)`
contains no reference to that filename. The file exists, the tool ignores it, and nothing says so.

What it does: writes a unique token into `~/.agents/AGENTS.md`, invokes each tool cold, greps
the reply for the token, then restores the file — in a `finally`, so a timeout cannot leave a
canary sitting in a live instruction file.

**Warn the user first: each probe is a real model invocation** (roughly 20k tokens for
`codex exec`). This is why it is explicit and occasional, and why `check` is the one wired to
SessionStart. Without `--all`, probes marked `costly` are skipped.

Read the results as three states, never two:

- `proven` — the token came back. Dated evidence, not an assumption.
- `FAILED` — wired but the tool did not read it. **This is the finding the tool exists for.**
  Do not soften it: the config is a placebo until it is fixed.
- `skipped` / `absent` — no claim either way. Say so rather than implying it passed.
