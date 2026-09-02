---
name: board
description: Show the task board for this repo — epics, in-progress, blocked, next unblocked, and stale work — from .bytedesk/task-management/. Use when the user asks "what's on the board", "where are we", "what's next", "/board", or when resuming work and you need the real state rather than session memory.
user-invokable: true
argument-hint: "[optional: next | stale | find <query>]"
---

# Board

The store is the truth; session todo state is a mirror of it.

## Process

1. `.bytedesk/task-management/bin/tm board` — epics with completion counts, then tasks by status, then anything stale.
2. Narrow when asked:
   - `.bytedesk/task-management/bin/tm next` — open tasks whose blockers are all done (what can actually be started).
   - `.bytedesk/task-management/bin/tm stale` — `in_progress` untouched past `staleMinutes` (default 90). Treat these as
     suspect: verify the work actually happened before continuing it.
   - `.bytedesk/task-management/bin/tm find <query>` — full-text over epics, tasks, and ADRs.
   - `.bytedesk/task-management/bin/tm log 40` — raw event tail.
3. **Report, don't re-plan.** Summarize what's in progress, what's blocked and by what,
   and the single best next task. Only propose new tasks if the user asks.
4. Live view: `.bytedesk/task-management/bin/tm-dashboard` (auto-started as a plugin monitor; port in
   `.bytedesk/task-management/dashboard.port`).

## Notes

- Starting work: `.bytedesk/task-management/bin/tm start <TM-id>` (respects the WIP limit, default 3).
- Handing off labelled work: [[dispatch]] / [[pool]], then [[collect]].
- Related: [[epic]], [[standup]], [[handoff]], [[events]].
