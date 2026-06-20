# platform-ops

Production release policy (TeamCity read-only) and Gitflow/Fleet operator.

Install:

```
/plugin install platform-ops@bytedesk
```

Bins forward to the platform checkout via `BYTEDESK_REPO_ROOT` / `CLAUDE_PROJECT_DIR`. `scripts/dev/workflow.mjs` remains in the platform repo (ADR-0058).
