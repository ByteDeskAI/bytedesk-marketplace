---
name: epic
description: Open or switch the active epic for this repo. Every task must belong to an epic — the PreToolUse gate denies TaskCreate until one is active, so this is the front door for any new body of work. Use when the user says "start an epic", "/epic", "new initiative", "switch epics", or when a TaskCreate was denied for having no active epic.
user-invokable: true
argument-hint: "[epic title, or an EP-id to switch to]"
---

# Epic

Epics are the parent record for tasks, ADRs, and captured plans in
`.bytedesk/task-management/`. One is active at a time, per repo.

## Process

1. **List what exists first** — `tm epic` (a `*` marks the active one). Don't open a
   second epic for work that belongs to an open one.
2. **Switch** if it already exists: `tm epic use <EP-id>`.
3. **Otherwise open one**: `tm epic new "<title>"` — this also sets it active.
   Titles are outcomes ("Close the memory plan gaps"), not activities ("memory work").
4. **Write the epic body** — open the file the CLI printed and fill in: why this exists,
   what done looks like, what is explicitly out of scope. This is what a future session
   reads first.
5. **Break it down** — create tasks with `TaskCreate` (they file under the active epic
   automatically) or `tm task new "<title>"`. Give each one acceptance criteria:
   `tm ac <TM-id> "<verifiable criterion>"`. A task without criteria can't be closed
   while `requireAcceptance` is on.

## Notes

- Closing: `tm epic done <EP-id>` clears it as active.
- An approved plan (`ExitPlanMode`) auto-creates an epic if none is active and links
  the plan file into `.bytedesk/task-management/plans/`.
- Related: [[board]], [[adr]], [[handoff]].
