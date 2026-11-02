---
type: Architecture
title: task-management and agent-orchestration stay independent of each other
description: "Each plugin works with the other absent: no cross imports, no manifest dependency, capability-check then skip silently (Ryan, 2026-09-25)"
tags:
  - plugin:task-management
  - plugin:agent-orchestration
  - architecture
status: stable
generated:
  by: knowledge-management/0.1.0
  at: 2026-09-25T15:27:39.234Z
tasks:
  - TM-236
  - TM-240
  - TM-244
  - TM-245
---

# task-management and agent-orchestration stay independent of each other

Each plugin works with the other absent: no cross imports, no manifest dependency, capability-check then skip silently (Ryan, 2026-09-25)

## The rule

Set by Ryan on 2026-09-25 (relayed by design-system lead d04c2baa) as non-negotiable. The two
plugins may use each other when both are installed, but each must work with the other absent:

- No `import` or `require` crosses the boundary in either direction.
- No dependency is declared in either `.claude-plugin/plugin.json`.
- A call into the other plugin first checks that it is present and **skips silently** when it is
  missing. It must not error, and must not block the rest of the operation.
- Each side carries a test that runs it with the other plugin absent.

## How it holds today (checked 2026-09-25)

- agent-orchestration shells out to the `tm` binary at a known path
  (`topology/lib/management.mjs:50`) and keeps its own small frontmatter parser rather than
  importing task-management's.
- task-management capability-detects the agent-orchestration binary in `lib/hostcaps.mjs` and
  reports `available: false` with a reason when it is missing.

## Where it bites

Any feature spanning both plugins. It is an acceptance criterion on TM-236, TM-240, TM-244 and
TM-245. TM-245 (supervisor stall alerts) is the riskiest: its tick calls task-management's health
verb, so it must skip that step, not fail the tick, when `tm` is absent.
