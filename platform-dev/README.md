# platform-dev

ByteDesk core implementation lifecycle — TDD engineer, feature start, PR-ready, worktree operator, architect, grounding, integration branches.

Install:

```
/plugin install platform-dev@bytedesk
```

Bins forward to the platform checkout via `BYTEDESK_REPO_ROOT` / `CLAUDE_PROJECT_DIR`. `scripts/dev/workflow.mjs` remains in the platform repo (ADR-0058).
