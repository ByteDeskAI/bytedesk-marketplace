---
name: groom
description: Backlog grooming pass over .bytedesk/task-management/ — close zombies, merge duplicates, unstick blocked tasks whose blockers are done, fill missing acceptance criteria, and re-rank what's next. Use when the board has drifted, before planning a new epic, or when the user says "clean up the backlog", "groom", "/groom", "this board is a mess".
user-invokable: true
argument-hint: "[optional: epic id to scope the pass]"
---

# Groom

Boards rot. This is the scheduled pass that makes the store trustworthy again.

## Process

Work through these in order, **proposing changes before making them** — grooming is
destructive-ish and the user should see the list first.

1. **Zombies** — `.bytedesk/task-management/bin/tm stale`. For each: is it actually done (close it), actually blocked
   (`.bytedesk/task-management/bin/tm block <id> "<why>"`), or abandoned (`.bytedesk/task-management/bin/tm park <id> "<why>"`)? Check git log and
   the files it names before deciding; a stale task is often finished work nobody closed.
2. **Duplicates** — `.bytedesk/task-management/bin/tm task` and scan for overlapping titles. Keep the one with history
   (evidence, commits, criteria), fold the other's body into it, and `.bytedesk/task-management/bin/tm park` the loser
   with a note pointing at the survivor.
3. **False blocks** — any `blocked` task whose `blockedBy` are all `done` → `.bytedesk/task-management/bin/tm unblock <id>`.
4. **Missing criteria** — tasks with no acceptance criteria can't be closed cleanly.
   Add them: `.bytedesk/task-management/bin/tm ac <id> "<verifiable criterion>"`. One or two, verifiable, not aspirational.
5. **Orphans** — tasks with no epic (created before an epic was active, or via override).
   Assign them by editing the task file's `epic:` field, or park them.
6. **Rank** — end with `.bytedesk/task-management/bin/tm next` and state the single best next task and why.

## Notes

- Never delete task files. Parking preserves the record; deletion loses the audit trail
  that `events.jsonl` is pointing at.
- Related: [[board]], [[standup]], [[epic]].
