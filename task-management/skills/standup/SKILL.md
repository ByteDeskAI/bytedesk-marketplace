---
name: standup
description: Summarize what changed in the task store since a point in time — tasks opened, started, closed, blocked, evidence and commits attached — read from the append-only event log. Use for "what did we do yesterday", "standup", "status update", "/standup", or when writing a progress report for someone who wasn't in the sessions.
user-invokable: true
argument-hint: "[ISO timestamp or omit for last 24h]"
---

# Standup

Reads `.bytedesk/task-management/events.jsonl`, which every write goes through — so
this is what actually happened, not what anyone remembers happening.

## Process

1. `tm standup` (last 24h) or `tm standup 2026-07-20T00:00:00Z` for a custom window.
2. Enrich the raw digest into a report:
   - **Closed** — tasks now `done`, with their acceptance criteria met and evidence refs.
   - **In flight** — `in_progress`, with how long they've been open (flag anything stale).
   - **Blocked** — what's blocked and on what; name the dependency, not just the count.
   - **New** — tasks/epics/ADRs created in the window.
3. **Be honest about gaps.** If a task went `done` with no evidence and no commits, say so
   rather than presenting it as verified.
4. For a cross-repo view, run it per repo — the store is per-workspace by design.

## Notes

- Related: [[board]], [[groom]].
