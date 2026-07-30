---
name: setup-cli
description: Put the agentconf command on the user's own PATH, so it can be run from a terminal or by another agent rather than only from inside Claude Code. Use after installing agentconf, when `agentconf` returns command not found in a shell, or when the user wants Codex or a script to invoke it.
user-invokable: true
allowed-tools:
  - Bash
---

```
agentconf install-cli
```

Then read the result back, including the PATH note if it appears.

## Why this is needed

Claude Code injects `${CLAUDE_PLUGIN_ROOT}/bin` into the **tool host's** PATH — not into the
user's interactive zsh/bash, and not into Codex's. That is a sharper problem for this plugin
than for most: agentconf's entire job is configuring the *other* agents, so a version only
Claude Code can call is the wrong half of the tool.

## Why a wrapper, not a symlink

A symlink pins one install path and breaks the moment an update removes it. The wrapper
resolves at call time, in this order:

1. the marketplace **source tree**, if present — a directory-source marketplace runs live from
   source, which is what a dev machine should use
2. otherwise the **most recently modified** cache directory

Note the second one is by mtime, not version sort. Copying fleet's `ls -dv … | tail -1` would
be silently wrong here: agentconf versions by commit SHA, and SHAs do not sort chronologically,
so version-sorting would pick an arbitrary old build and nothing would say so.

## If it refuses

`install-cli` will not overwrite a `~/.local/bin/agentconf` it did not write — it checks for
its own sentinel comment. If it reports `refused`, tell the user what is at that path and let
them decide. Do not force it.
