# TM-143 — exact revision for the integrator

**Merge this:** the head of branch `tm/TM-143-per-recipient-refusal`, rebased onto `main` at
`9c765c3`. Named by branch rather than by SHA because this file's own commit moves the head; the
code commit is `11976f4` and anything after it is evidence.

## The defect, in one paragraph

TM-142 fixed the *broadcast* refusals by resolving addresses before allocating a sequence number.
The refusals raised **inside** the per-recipient loop — `TOPOLOGY_ROUTE_BLOCKED`,
`TOPOLOGY_ROUTE_NO_LEAD`, `TOPOLOGY_ROUTE_LOOP`, `TOPOLOGY_UNKNOWN_AGENT`,
`TOPOLOGY_COORDINATOR_NOT_A_WORKER` — still threw with the envelope already persisted, and once
several recipients were addressed at once they threw *after* the recipients ahead of the refused one
already had an inbox file. The sender saw an error, some agents had the message, and `run.json` said
a message existed.

## The mechanism, argued rather than assumed (AC1)

`sendMessage` now runs **one admission pass above `nextSequence`**. The router is consulted once per
recipient and all five refusals are raised there, where a refusal consumes no sequence number,
writes no envelope and writes no inbox file. The write pass **reuses** the admitted decision instead
of re-calling the router, so a policy that changes in between cannot admit one pass and refuse the
other.

Prevention rather than rollback, and the argument is TM-142's own, one level down: a sequence number
cannot be handed back. Unwinding inbox files has the same shape of problem — the unlink races a
pointer delivery that may already have woken the recipient, and a message an agent has begun reading
cannot be made not to have been read.

The five refusals are factored into one `assertRoutable` helper, called by the admission pass and
re-asserted against the roster `nextSequence` returned, so the two passes cannot drift about what a
refusal means.

## VERIFIED, and how

**The tests are non-vacuous.** Five new tests in `tests/unit/topology-send-atomicity.test.mjs` assert
on the **filesystem**, not on the error — the old code raised the identical error while delivering to
everybody ahead of the refused recipient, so an error-shaped assertion would have passed against the
bug. Against unmodified `main`, in a `git archive` extract, **three of the five fail**:

```
not ok 1 - a coordinator LAST in the list refuses the whole send: nobody ahead of it is delivered to
not ok 2 - an unknown agent LAST in the list refuses the whole send, and burns no sequence number
not ok 3 - a router that blocks the LAST recipient refuses the whole send
# tests 5   # pass 2   # fail 3
```

With the fix: 5 pass, 0 fail.

**Gates on the rebased revision** (`node --test --test-concurrency=1`):

| Gate | Result |
|---|---|
| `agent-orchestration` unit, all files | 504 tests, 500 pass, 0 fail, 4 skipped |
| `agent-orchestration` contract | 6 tests, 5 pass, 0 fail, 1 skipped |
| `roadmap:check` | `ROADMAP OK: 55 tasks, 96 unlocks, 6 goals, 7 trajectories, 7 gaps` |
| `validate_presence.py`, frozen and unmodified | `ok — 7 snapshot(s) conform to Presence v1 (contract revision 3)` |
| `test_validator.py`, frozen and unmodified | `all negative tests pass` |
| `task-management` unit | 1364 tests, 1364 pass, 0 fail |
| operator tmux sessions, before and after | 1364 tests, 1364 pass, 0 failUX |

504 is exactly `main`'s 499 plus this branch's 5 — additive, no displacement.

**`build:check` is NOT in that table, and the reason is not the one I first gave.**

It exits non-zero **in this worktree** and exits zero in the canonical checkout at the same
revision with the same esbuild (0.28.2). It is not stale, and it is not `main`'s. My first
conclusion — "fails on unmodified `main`" — was wrong, and the way it was wrong is worth recording
because it is the third instance of one shape in this epic.

I held esbuild constant by sharing `node_modules` with the working tree. Pinning esbuild is the
right variable to pin. But `node_modules` can only be shared here by symlink, and esbuild writes
each bundled module's **resolved path** into the output as a comment — so through the symlink those
comments read `../../../../agent-orchestration/node_modules/...` instead of `node_modules/...`. The
integrator measured it: first differing byte 310, inside exactly that comment; 97 comments
rewritten; the same 97 modules on both sides; the rebuilt bundle 3,104 bytes larger, path text and
nothing else. **The control introduced the confounder it was meant to exclude.**

The lesson, in the form the integrator put it and which I accept: isolation is never free. Every
isolation mechanism removes something, and the question is what this one removes and whether the
check depends on it. A `git archive` extract removes `.git` — that made the MCP handshake test fail
by construction earlier in this epic. A symlinked `node_modules` removes path identity. Both are
invisible until something embeds them.

**TM-152 stands, retargeted rather than closed**, because a real defect fell out of the mistake:
`build:check` only passes from one directory on this machine, and every dispatched worker in this
epic works in a worktree — so every one of them sees a false failure and cannot tell it from a true
one. Report it here as "fails in worktree, TM-152", never as this branch's gate result. Prior
"build:check pass" readings across EP-018 stand; the live warning is the reverse.

## READ ONLY, not executed

- The standing/external branch on a **live** cross-repository send. The new tests exercise the local
  path; the standing path's behaviour here is unchanged by this commit and was read, not run.
- Any live tmux delivery. This change is entirely above the pointer-delivery layer, and no
  end-to-end send to a real pane was performed for TM-143.

## The one residual, named rather than hidden

The standing/external path is deliberately **not** pre-flighted, because its delivery *is* its
admission: `sendStandingMessage` runs canonical routing itself and reports a refusal as a **hold**,
not a throw, so it cannot partially deliver on a routing refusal. Exactly one case remains where a
refusal can still follow a delivery — an assignment that the standing router redirected onto a local
`coordinates_only` agent. A standing delivery cannot be unwound (the record is durable and the
pointer may already have been rung), so it throws with the delivery recorded rather than pretending
it did not occur. Documented at the branch and on the task.
