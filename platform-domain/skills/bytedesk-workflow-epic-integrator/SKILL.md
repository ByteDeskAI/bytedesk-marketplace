---
name: bytedesk-workflow-epic-integrator
description: >-
  Integration manager for large ByteDesk workflow-system epics with many
  parallel agents or goal docs. Use for workflow DSL/node-kind/operator epics,
  workflow workbench, database-driven workflow config, node-as-function work,
  cross-repo Platform/Omnigent batches, merge conflict integration, existing
  kind/name collision checks, and final combined runtime proof after agents
  finish.
user-invokable: true
argument-hint: "[plan manifest or epic key]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Prevent isolated-agent success from becoming integrated-system failure. This
skill sits between `run_goals` and PR-ready for workflow-system epics.

## Pre-Batch Checks

Before dispatching or merging workflow tasks:

```bash
scripts/dev/workflow.mjs status
git fetch origin develop --prune
```

For Omnigent tasks, also:

```bash
cd /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-omnigent
git fetch origin main --prune
rg -n '"(kind|op)":|OperatorKind|BUILTIN_CLASSIFY|nodeRegistry|NODE_EXECUTORS' packages plugins
```

Check for:

- new node/operator names colliding with existing kinds
- stale registry precedence tests
- generated artifact drift (`workflow-node-kinds.json`, descriptors, schema)
- overlapping migrations or seed catalogs
- two agents touching the same registry/visitor/parser files
- Omnigent task using Platform worktree assumptions

## Integration Gate

After parallel agents report PASS:

1. Create a fresh Platform integration worktree from `origin/develop`.
2. Merge passed Platform branches one at a time. Stop on non-trivial conflicts.
3. For Omnigent branches, create/use a separate Omnigent integration worktree
   from `origin/main`; merge passed Omnigent branches one at a time.
4. Run the combined test gates once:
   - Platform unit/build gate relevant to changed services.
   - Omnigent `npm test` in touched packages/plugins.
   - Frontend build/browser smoke for Web changes.
5. Run `bytedesk-workflow-runtime-smoke` if the combined change affects
   workflow execution or UI.
6. Only after the combined gate is green should PRs land.

## Conflict Handling

Treat conflicts in these files as design conflicts, not clerical conflicts:

- DSL type unions, visitors, registry precedence, parser factories
- `NODE_EXECUTORS`, operator registries, descriptor registries
- Office workflow seed catalog and EF migrations
- generated workflow descriptor/schema artifacts
- Web workflow inspector/designer surface files

Resolve by re-inventorying current main/develop and preserving existing kinds.
If the new name is taken, rename the new feature rather than overriding the
existing one.

## Final Report

```markdown
Workflow epic integration: PASS/FAIL
Branches integrated: <list>
Collision checks: <results>
Combined tests: <commands and result>
Runtime smoke: <result or why not needed>
Landed PRs: <list>
Blocked/deferred: <only real blockers>
```
