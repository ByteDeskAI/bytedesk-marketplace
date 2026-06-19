# platform-ops

Production release policy (TeamCity read-only) and Gitflow/Fleet operator.

Install:

```
/plugin install platform-ops@bytedesk
```

## Skills

- `bytedesk-production-release-teamcity`
- `bytedesk-devops-engineer` (includes bundled `scripts/` helpers)

## Bins

| Bin | Platform script |
|---|---|
| `release-status` | `scripts/dev/release-status.mjs` |

Bins forward to the platform checkout via `BYTEDESK_REPO_ROOT` / `CLAUDE_PROJECT_DIR`. `scripts/dev/workflow.mjs` remains in the platform repo (ADR-0058).