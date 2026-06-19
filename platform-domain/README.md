# platform-domain

Bounded-context proof operators — DBA, tool actions, Office workflows, DevProjects, remote gateway.

Install:

```
/plugin install platform-domain@bytedesk
```

## Skills

- `bytedesk-dba`
- `bytedesk-tool-action-engineer`
- `bytedesk-workflow-runtime-smoke`
- `bytedesk-workflow-epic-integrator`
- `bytedesk-maya-workflow-router`
- `bytedesk-devprojects-sandbox-refresh`
- `bytedesk-devproject-domain-operator`
- `bytedesk-remote-gateway-operator`

## Bins

Bins forward to the platform checkout via `BYTEDESK_REPO_ROOT` / `CLAUDE_PROJECT_DIR`:

| Bin | Platform script |
|---|---|
| `workflow-runtime-smoke` | `scripts/dev/workflow-runtime-smoke.mjs` |
| `workflow-registry-drift-proof` | `scripts/dev/workflow-registry-drift-proof.mjs` |
| `devproject-domain-proof` | `scripts/dev/devproject-domain-proof.mjs` |
| `devproject-sandbox-refresh-proof` | `scripts/dev/devproject-sandbox-refresh-proof.mjs` |
| `host-diagnostics` | `scripts/dev/host-diagnostics.mjs` |
| `lint-bundled-workflows` | `scripts/dev/lint-bundled-workflows.mjs` |

`scripts/dev/workflow.mjs` remains in the platform repo (ADR-0058).