---
name: omnigent-operator
description: Omnigent repo operator for worktree lifecycle, workflow.mjs commands, status checks, ship/land/cleanup, local server and host smoke, CLI configuration, and PR-state proof in bytedesk-omnigent. Use for "status", "start a branch", "ship", "land", "is this landed", "cleanup", "run local server", "host", or any operational repo workflow.
---

# Omnigent Operator

## Mission

Use the repo's own workflow and CLI surfaces instead of ad hoc git or process handling. Keep canonical `develop` clean and do implementation work in a feature worktree unless the user explicitly asks for read-only inspection.

## References

Read as needed:
- `references/generated/cli-surface.md`
- `references/generated/repo-map.md`

Refresh when stale:
```bash
node scripts/dev/workflow.mjs omnigent-skills check
```

## Workflow

1. Inspect:
   ```bash
   git status --short --branch
   node scripts/dev/workflow.mjs status --no-fetch
   ```
2. Create work:
   ```bash
   node scripts/dev/workflow.mjs new <slug> origin/develop
   ```
3. Verify with the focused command from the specialist skill plus `workflow.mjs verify` when appropriate.
4. Ship or land only after the worktree diff is understood:
   ```bash
   node scripts/dev/workflow.mjs ship --message "<summary>"
   node scripts/dev/workflow.mjs land <branch>
   ```
5. Prove landed state with PR state, merge ancestry, and workflow status.

## Local Runtime Smoke

- Server: `uv run omnigent server start`, then `uv run omnigent server status`.
- Host: `uv run omnigent host --server <server-url>`.
- One-shot agent: `uv run omnigent run <agent-dir> --server <server-url> -p "<prompt>"`.
- Stop: `uv run omnigent stop` or `uv run omnigent server stop` depending on scope.

Never print secrets or model-provider tokens.
