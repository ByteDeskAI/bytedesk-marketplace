---
name: bytedesk-architecture-sync
description: >-
  Structurizr C4 drift gate for ByteDesk Platform. Use when editing
  src/ByteDesk.* services, shared contracts/infra, or Helm service topology;
  before commit or PR when architecture-relevant paths change; when pre-commit
  or Stop hook reports architecture-sync violations; or when updating
  docs/architecture/workspace.dsl. Wraps architecture-sync.mjs and platform-local
  Structurizr DSL validation.
user-invokable: true
argument-hint: "working-tree | audit [--base origin/develop] | refresh | partition <service>"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

## Mission

Keep `docs/architecture/workspace.dsl` aligned with code changes. The pre-commit
hook blocks arch-relevant commits without a staged diagram update — this skill
teaches agents to fix drift **before** the hook fires.

## Partition map

Partitions live in `docs/architecture/anchors.yaml`. Common anchors:

| Partition key | Typical paths |
|---|---|
| `gateway` | `src/ByteDesk.Gateway/**` |
| `identity` | `src/ByteDesk.Identity/**` |
| `sales` | `src/ByteDesk.Sales/**` |
| `tools` | `src/ByteDesk.Tools/**` |
| `shared-contracts` | `src/ByteDesk.Shared.Contracts/**` |
| `shared-infrastructure` | `src/ByteDesk.Shared.Infrastructure/**` |

Run `architecture-sync --mode working-tree` to see which
partitions your staged diff touches.

## Procedure

### 1. Detect impact (always first)

```bash
architecture-sync --mode working-tree
git diff --name-only origin/develop...  # PR audit
```

If output is empty / "ok", no diagram update required for this change.

### 2. Update diagrams

For **surgical** changes (new container, relationship, tag):

1. Read the affected partition in `docs/architecture/workspace.dsl`.
2. Apply the minimal DSL edit (C1–C2 default; C3 only when the plan requires it).
3. Validate: `architecture-sync --mode audit`.

For **large** or **new-service** changes:

1. Read the affected partition and matching ADRs before editing.
2. Use `git diff -- docs/architecture/workspace.dsl` before commit to review wire-shape changes.

Stage **both** code and diagram:

```bash
git add docs/architecture/workspace.dsl   # or fragments/*.dsl
git add src/ByteDesk.<Service>/...
```

### 3. Refresh fingerprint lockfile (when anchors or broad rescans change)

```bash
architecture-sync --mode refresh
git add docs/architecture/.arch-sync-state.json
```

Only refresh when partition coverage or anchor globs changed — not on every
one-line relationship fix.

### 4. PR / CI audit

```bash
architecture-sync --mode audit --base origin/develop
bash scripts/testing/local-test.sh architecture-sync
```

## Handoffs

| Situation | Skill |
|---|---|
| Pre-implementation plan review | `/bytedesk-architect` (C4 impact bucket) |
| Full codebase decomposition | `/bytedesk-architecture-decompose` |
| Ship with diagram diff | `/bytedesk-pr-ready` §3c |
| Landed + diagram on develop | `/bytedesk-worktree-operator` `landed` |

## Banned

- Committing arch-relevant code without `workspace.dsl` / `fragments/` staged.
- Staging only `.arch-sync-state.json` or `anchors.yaml` to satisfy the gate.
- Hand-editing `workspace.json` or `.structurizr/` — generated/local only.