---
id: "CAP-0002"
kind: "capability"
status: "open"
created: "2026-09-09T07:04:58.641Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Stop gate mis-attributes a claim that has no session id"
area: "task-management"
impact: "M"
effort: "S"
confidence: "H"
source: "TM-127 handoff, 2026-09-09"
evidence: []
related: []
updated: "2026-09-10T01:36:00.118Z"
---

## Problem / job-to-be-done

A claim with `session: null` cannot be attributed to anybody, so the Stop gate cannot tell "this
task is held by the session that is stopping" from "this task is held by somebody else". It treats
the unowned claim as everyone's, and every session's Stop hook nags about a task it does not hold.

The nag is the visible symptom. The real cost is that the gate stops meaning anything: an operator
who sees it fire on tasks they never touched learns to ignore it, and then it also gets ignored on
the day it is right.

## Current state

Three writers can produce a null-session claim today:

- `tm claim` / `tm start` run from a plain shell, cron or a script with no harness session variable
  exported. `sessionId()` walks `SESSION_ENV` and finds nothing.
- Any dispatch backend called DIRECTLY rather than through `lib/dispatch/index.mjs`. `dispatch()`
  synthesises `dispatch-<id>` when the caller passes no session (index.mjs), so the normal path is
  already safe — but a backend's `spawn()` is a public function and nothing stopped it being called
  with `session: null`.
- Legacy claims written before the interlock existed. `lib/claims.mjs` deliberately treats a claim
  with no session as interlock-free, which is what makes it un-attributable.

The root cause was only ever recorded in TM-127's comments; this entry existed as an empty stub.

## Proposed enhancement

Close the writers one at a time, cheapest first, rather than teaching the gate to guess.

TM-135 closed one of them and is the pattern for the rest: `lib/dispatch/idle.mjs`'s `spawn()`
refuses a request whose `session` is null, before it writes the handoff file or shells out, and the
refusal names CAP-0002. Idle dispatch would otherwise have ADDED a writer — a standing agent told
to run `tm` bare in its own directory would re-create the shape — so the handoff carries an
explicit `TM_SESSION_ID` (the DISPATCHING session, which is the one holding the claim) and the
assignment pointer tells the agent to export it. That path can now only ever write an owned claim.

Remaining work:

1. Apply the same assert to the other backends' `spawn()` entry points.
2. Decide what `tm claim` does with no session at all: synthesise (as `dispatch()` does), refuse, or
   keep writing an unowned claim and mark it explicitly `unowned: true` so the gate can skip it by
   name rather than by inference.
3. Only then change the gate, and only to skip claims that are explicitly unowned.

## Acceptance criteria

- [ ] Every dispatch backend refuses a null session at its own entry point, with a reason naming CAP-0002 (idle.mjs done, TM-135).
- [ ] `tm claim` / `tm start` with no harness session either synthesise an attributable id or refuse; the chosen behaviour is documented in README.
- [ ] A pre-existing unowned claim is distinguishable from a new one, so the Stop gate can skip it without guessing.
- [ ] The Stop gate no longer nags a session about a task held by nobody.

## Non-goals

- Rewriting or migrating historical claims. They are data; the gate must cope with them.
- Removing the interlock-free treatment of unowned claims in `lib/claims.mjs`. That is what keeps
  legacy state readable, and changing it is a separate decision.
- Any change to how a claim is stolen (`--steal`) or heartbeated. This entry is about attribution
  only.
