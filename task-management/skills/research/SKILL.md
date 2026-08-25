---
name: research
description: AFK research against primary sources; write a cited pack under .bytedesk/task-management/research/ and attach it as evidence. Resolves decision:research tickets. Use when a fact outside the working directory is blocking a decision, or the user says /research.
user-invokable: true
argument-hint: "[TM-id or the question]"
---

# Research

Run as a **background/subagent** so the parent keeps working. Primary sources only (official docs, source, specs, first-party APIs).

1. Investigate the question. Cite every claim.
2. Write `.bytedesk/task-management/research/<date>-<slug>.md` with `task: TM-…` in frontmatter when a ticket exists (`capability:` when this is for `/enhance`).
3. `tm_evidence` that path onto the ticket.
4. Write `## Answer` (the fact, not a dump), tick AC, `tm_task_update` done.

May run in parallel with other research tickets. Do not write product code. Prefer store evidence over a throwaway git branch.
