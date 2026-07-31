---
name: handoff
description: Produce a self-contained brief for one task — context, acceptance criteria, blockers, evidence, commits — so a subagent, a worktree session, or tomorrow's session can pick it up cold. Use when delegating work, spawning a parallel agent, ending a session mid-task, or when the user says "hand this off", "/handoff", "write this up for another agent".
user-invokable: true
argument-hint: "<TM-id>"
---

# Handoff

A handoff is only useful if the receiver needs nothing else. `tm handoff <TM-id>`
assembles what the store knows; you fill the gaps it can't know.

## Process

1. `tm handoff <TM-id>` — emits status, epic, branch/worktree, body, acceptance criteria,
   blockers, evidence, and linked commits.
2. **Read it as the receiver would.** If it doesn't answer "where do I start" and
   "how will I know I'm done", the task body is thin — fix the source, not the output:
   `tm ac <id> "<criterion>"` for missing criteria, and edit the task file for context
   (paths that matter, commands that work, prior art, dead ends already ruled out).
3. Re-run `tm handoff` and pass the result as the agent prompt / paste it into the
   worktree session.
4. **Park before you leave**: if you're handing off because the session is ending, set
   the state honestly — `tm park <id> "<where I stopped>"` or leave it `in_progress`
   only if someone is actively continuing. The Stop gate will remind you.

## Notes

- Claims are per-session (`state.json`); a handoff to a parallel session should be
  followed by `tm start <id>` in *that* session so the claim moves.
- Related: [[board]], [[epic]].
