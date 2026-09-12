---
id: "ADR-0012"
kind: "adr"
status: "accepted"
created: "2026-09-11T19:32:50.300Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agent-first automation: auto-label readiness, pool on by default, guarded workers, PR finish line"
epic: "EP-021"
decisionKey: "5bf515134ea3"
date: "2026-09-11"
updated: "2026-09-11T19:44:03.124Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-11, while planning EP-021.

Until now the agent-first pool rested on two choices that were never recorded as an ADR:

- **The label was manual.** `ready-for-agent` was "the human's go-ahead" (README.md "a loop that guessed at what
  to run would be deciding, which is the human's job"). No code applied it, and no check tested whether a task was
  complete enough for an agent.
- **The pool was opt-in.** "An autostarted daemon nobody asked for must not start dispatching work"
  (`lib/dispatch/pool.mjs` header, commit 3ef5c22). The monitor read `dispatch.enabled` once and exited, so turning it
  on mid-session did nothing.

Reading the code while planning also found defects that made unattended running unsafe:

- pool dispatch skipped the start gate;
- `poolWip` stopped holding after the agent TTL;
- a stop sent mid-tick was lost;
- running work was ignored for collisions;
- a failed dispatch leaked its worktree;
- the pid file could race;
- `tm config <key>` deleted the key it appeared to read.

Workers also ran with `--dangerously-skip-permissions` and no guard.

## Decision

**How should a task become ready-for-agent? (Today only a human adds the label; nothing checks whether a task is actually complete enough.)** → chose **Auto-label, human veto (Recommended)**.

Rejected:
- **Auto-suggest, human approves** — The readiness check runs and shows what is missing, but tasks land in needs-triage. One command or click (`tm approve`) promotes them. Keeps the recorded 'the label is the human's go-ahead' principle.
- **Keep manual, add the report** — No automatic labels. Add only the readiness check to `tm why`, the dashboard and the pool, so you can see why a task isn't ready.

**What should the pool's default be once the safety fixes land?** → chose **On by default (Recommended)**.

Rejected:
- **On after per-repo consent** — The first session in a repo announces the pool and asks once; the answer is stored in that repo's config. Other repos are unaffected until they opt in.
- **Opt-in, but live** — Default stays off, but turning it on takes effect within one poll, with no new session needed.

**What may an unattended worker do? Workers currently run `claude -p --dangerously-skip-permissions` with no guard.** → chose **Skip-permissions + guard hook (Recommended)**.

Rejected:
- **Restricted permission mode** — Workers run with acceptEdits and an allowlist of tools. Safer, but a worker that needs something outside the list stalls on a prompt nobody is there to answer.
- **Leave as is** — Keep --dangerously-skip-permissions with no guard.

**Where should an automated worker's job end?** → chose **Push branch and open a PR (Recommended)**.

Rejected:
- **Commit on branch only** — Current behaviour: commit in the worktree and run `tm done`. A human pushes and merges.
- **Merge automatically when checks pass** — The worker opens a PR and merges it once tests and CI are green. Most automatic, and also a PR-level action with no human in the loop.

## Consequences

**What this makes easy**

- A complete task reaches a worker with no manual step: readiness is computed from one check
  (`agentReadiness`), and the label is kept in sync inside the store's write.
- Turning the pool on or off takes effect within one poll, from the CLI or the dashboard.

**What this makes hard, or riskier**

- Every repo that uses the plugin runs the pool by default, so any well-specified task can be picked up without
  anyone naming it. Mitigations:
  - the pool ships only after the safety defects above are fixed (TM-175, TM-174);
  - `ready-for-human` (or any triage label a person set) is a sticky veto;
  - a failure and quota brake pauses the pool;
  - a PreToolUse guard blocks repo-destructive and external commands for workers (TM-177);
  - a human still merges every PR.
- Tasks that need human access, such as credentials or a UI, must be vetoed explicitly; the check cannot see that.
- Workers keep skipped permissions, so the guard is the only barrier against destructive commands, and its pattern
  list must be maintained.

**Revisit if**

- the guard is bypassed in practice;
- auto-labelled tasks are dispatched that plainly needed a person;
- spend from unattended workers becomes a problem, which would call for a budget cap rather than a failure brake;
- CI becomes trustworthy enough to consider merging when checks pass.