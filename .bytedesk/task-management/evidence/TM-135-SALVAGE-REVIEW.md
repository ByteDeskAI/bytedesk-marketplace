# TM-135 — review of the salvaged half (`a5d550e`)

Reviewed by the TM-135-dispatch worktree dispatcher, because its author's session
crashed before reporting and the commit was made unreviewed purely to avoid
losing the work. This is that missing review.

## What `a5d550e` actually changes

```
agent-orchestration/topology/cli.mjs             10 +-
agent-orchestration/topology/lib/management.mjs 160 +++-
task-management/lib/dispatch/backend.mjs         22 +-
task-management/lib/dispatch/idle.mjs           126 +++
```

Four files, 311 insertions. **`task-management/lib/dispatch/index.mjs` is not
touched**, which the brief required: a backend is invoked after the claim and
after provisioning, so `dispatch()`'s ordering invariants hold without edits, and
a refusal rolls back through the existing `fail()` path that never releases a
pre-existing claim.

(Note for anyone re-checking: `git diff main..HEAD` on this branch lists ~40
files. That is divergence — `main` has moved on — not this commit's edits. Use
`git show --stat a5d550e`.)

## The load-bearing invariant HOLDS

The double-assignment hazard was the thing most likely to be got wrong: if the
idle check happens in the pool and the assignment write happens in the backend,
two ticks both see an agent idle, both provision a worktree, and the agent
silently interleaves two tasks.

`assignTaskToAgent` (`management.mjs:402`) does the whole decision **inside one
`withLock(assignmentLock(ctx), …)` critical section** — load the record, assert
no live assignee, read the census, compute currently-held assignments, filter to
`dispatchable && !held`, pick, deliver, write. The census is consulted inside the
lock, not before it. Correct.

## Other things it gets right, verified in the code

- **CAP-0002, twice.** `idle.mjs` `spawn()` refuses a null session with a reason
  string that explains *why* ("a null-session claim cannot be attributed to the
  agent that holds it"), and `assignTaskToAgent` independently asserts
  `nonempty(owner)` — "an unowned claim cannot be handed to anyone". Belt and
  braces at two layers.
- **A stale census dispatches nothing.** `invariant(census && !census.stale, …)`
  with "Nothing is dispatchable from a stale or missing census." That is exactly
  TM-131's rule, honoured rather than re-derived.
- **Retry safety.** `assignmentMessageId` is a derived id, so a retried
  assignment delivers nothing twice — the same discipline TM-132's slot grants
  use.
- **Honest error text.** The no-idle-agent error enumerates every agent and its
  observed state, so the operator sees *why* nothing was dispatchable.
- The header comment already anticipates census lag: "the agent it calls idle has
  had a minute to start working."

## Verdict

The salvaged half is sound and its central invariant is correct. It is a
reasonable base for the remaining work; I found nothing that needs unwinding
before Part B lands on top.

## What is NOT in it, and remains open

`collectIdle` and its routing entry; the `dispatch.preferIdle` pool preference;
and the whole of Part B — `topology/lib/quota.mjs`, `failover.consent`, the three
false-positive defences, and the failover survival semantics. No tests exist for
any of it yet. Those are in flight.

**Not yet verified by anyone:** whether this half actually runs. No gate output
exists for `a5d550e` — its author never reported one, and this review is a source
review only.
