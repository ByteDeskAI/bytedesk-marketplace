---
type: Architecture
title: The goal planner's governed-proposal boundary
description: Why an agent cannot write to the board, and the four invariants that make that true
tags:
  - task-management
  - planner
  - security
status: stable
generated:
  by: knowledge-management/0.1.0
  at: 2026-09-05T15:10:24.416Z
---

# The goal planner's governed-proposal boundary

An operator states a goal in prose; an agent proposes board operations; the operator approves an
exact set; the board changes. The product claim is narrow and worth stating precisely, because
every defect found in three rounds of review was a violation of one of these four sentences and
nothing else:

1. **An agent cannot write to the board.** It can only ask, by calling one MCP tool
   (`tm_plan_propose`) from a narrowed table that exposes the board's reads and nothing that
   mutates. The narrowing is enforced where tools are CALLED, not only where they are listed —
   hiding a write tool from `tools/list` while `tools/call` still executes it is theatre.
2. **An approval authorises exactly what the operator was shown.** The proposal is digested; the
   apply recomputes that digest independently and refuses anything else. Every implicit value —
   most importantly a `task.create` with no epic — is made explicit BEFORE the digest is taken, so
   the card names the destination and the approval binds it.
3. **An approval is spent once.** The proposal is claimed off the session under the store lock, so
   a double-click cannot replay it. Everything after the write lands is bookkeeping, and a
   bookkeeping failure must never hand the approval back.
4. **A landing is all of it or none of it** — including when the process is killed rather than
   throwing. Records are written one file at a time and nothing makes that atomic, so a landing
   writes down its intent first and the next attempt undoes it.

## The rule that generated the most defects

**A preview must cost nothing and must say what the apply will do.**

Both halves were violated. `check()` is documented read-only and was not: it called the board's own
gate, which SPENDS the operator's one-shot override at each refusal point — so previewing wrote
board state from the read-only planner profile, and because the page re-proposes on load, a refresh
burnt the token. And a preview that says "valid" while the apply refuses is worse than no preview at
all, because the operator has already approved. Every gate the CLI obeys is now evaluated at
preview WITHOUT paying for it, and paid for once, in the lock, at the write.

The corollary, learned twice: an exemption must skip one rule, not everything after it. Forgiving
the "no active epic" refusal at the call site skipped completeness and WIP with it, because that
check RETURNS. Tell the gate what is true (`haveEpic`) rather than editing its answer.

## Where the danger actually is

The recovery mechanism, not the agent. The agent is untrusted and boxed; the recovery code runs as
the operator and DELETES records. Its first version swept every record created after the
interrupted landing began, reasoning that the landing held the store lock so nothing else could
have written. **The lock dies with the process; the journal does not.** A dashboard killed on
Monday and a week of ordinary CLI work would have been deleted on Friday by the first person to
reopen the session.

The rule that replaced it: *undo nothing you did not write down before you did it.* Ids are
reserved with `nextId` under the lock the landing already holds, journalled, and then created with
that exact id — so the journal names every record before it exists, and no ownership heuristic is
needed. Two consequences worth keeping: the reservation must interleave with creation (`nextId` is
`max(existing)+1` off the directory, so reserving several up front hands out the same number), and
the journal is read back after a crash, which makes it INPUT — its paths are confined and its
shape is checked.

## Granularity is a design decision, not a detail

A one-shot override authorises one operator decision. That is a landing, not an operation: spending
per operation made a two-task proposal preview as valid and then fail halfway, burning the token so
the retry failed too. One token covers the whole approved set — defensible precisely because the
digest binds it, so the operator saw every operation before spending it. If the 100-operation
proposal cap ever rises, that is the reasoning to re-examine.

## For whoever touches this next

Measure, do not assert. The live harness, the capture matrix and the browser tests each surfaced
defects that passed code review, and three of the worst findings here came from probes that ran the
code rather than from reading it. A test that would pass against the broken behaviour is not a
test: the profile test that proves the planner writes nothing passed for months against a
`check()` that was spending the operator's override, because it called the one tool that can write
with arguments that died at validation. Prove a test bites by putting the defect back.

Related: [[task-management-architecture]].
