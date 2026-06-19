# ByteDesk Named Agents

Eight focused agents complement the monolithic `bytedesk-software-engineer` skill. Each agent owns one friction bucket from transcript analysis (grounding, lifecycle, goals, architecture, UI proof, workflows, implementation, integration review).

## Dispatch

```bash
named-agent-dispatch list
named-agent-dispatch show platform-builder
named-agent-dispatch suggest "ship BDP-123 after browser smoke"
agent-fleet-dispatch roster
agent-fleet-dispatch plan --text "add Sales contact export endpoint"
```

Fleet plugin (`/fleet:spawn`) can target these slugs when spawning parallel worktrees.

## Roster

| Slug | Role | Primary skills |
|---|---|---|
| `platform-builder` | TDD implementation | software-engineer, feature-start |
| `lifecycle-operator` | Worktree / ship / land | worktree-operator, pr-ready |
| `architecture-modeler` | C4 + drift gate | architecture-sync, architecture-decompose |
| `ui-proof-runner` | Browser smoke | browser-test, atomize |
| `workflow-runtime-verifier` | Office workflow proof | workflow-runtime-smoke |
| `goal-orchestrator` | Goals + manifests | goals, plan_goal, run_goals |
| `grounding-analyst` | Catch-up / context | ground, session-start |
| `integration-reviewer` | Pre-PR review | architect, pr-ready |

## Real-world test scenarios

See the user-facing examples in project docs or run `named-agent-dispatch suggest` with your task text. Canonical scenarios:

1. **platform-builder** — "Implement BDP-1491: add `GET /api/sales/contacts/{id}/timeline` with unit + integration tests."
2. **lifecycle-operator** — "Ship and land `feature/BDP-1491-contact-timeline` after pr-ready is green."
3. **architecture-modeler** — "Sales partition changed Program.cs routes — refresh `workspace.dsl` and pass architecture-sync audit."
4. **ui-proof-runner** — "Browser smoke the Contacts detail page after the timeline panel ships."
5. **workflow-runtime-verifier** — "Prove `prospect-research` bundled workflow loads from `/api/office/workflows/sources` and renders in Workflow Surface."
6. **goal-orchestrator** — "Run `docs/goals/workflow-surface-v2.plan.json` wave 3 sequentially."
7. **grounding-analyst** — "Ground yourself on the last 24h — what shipped and what's still In Progress in Jira?"
8. **integration-reviewer** — "Architect review the BDP-1491 plan before implementation; then run architecture-sync audit before PR."