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

---

# CORRECTION (appended after `8631f2b`) — this review was wrong twice

The review above is retained unedited so it stays legible as what was actually
claimed. Two of its claims are false. The implementer of Part B found both by
reading the same code this review read, which is the point: **a source review
that finds nothing is a weaker result than one that finds something, and this
one should not have been reported as a clean bill.**

## Wrong claim 1 — "Retry safety. `assignmentMessageId` is a derived id, so a retried assignment delivers nothing twice"

The derivation was the bug, not the safety property.

At `a5d550e` the id was `assignmentMessageId(ctx, task, agentId)` — a pure
function of `(repo, task, agent)`:

```
a5d550e management.mjs:340   const assignmentMessageId = (ctx, task, agentId) =>
a5d550e management.mjs:421   const messageId = assignmentMessageId(ctx, task, pick.agentId);
```

Release an assignment and hand the same task back to the same agent and the id is
byte-identical to the first round's. `sendStandingMessage` dedupes on it, so the
second pointer is never delivered — and `assignmentResult` then reads the
**previous** round's reply as this round's completion. The task collects instantly
with a stale outcome and the second attempt is invisible. Idempotence across a
retry of the *same* attempt is the property that was wanted; identity across
*different* attempts is what was written.

Fixed at `8631f2b` by making the round load-bearing:

```
8631f2b management.mjs:352   const assignmentMessageId = (ctx, task, agentId, round) =>
8631f2b management.mjs:441   const round = (prior?.events ?? []).filter(e => e.event === 'assigned').length;
```

## Wrong claim 2 — "`dispatch.preferIdle` … remains open"

It was already implemented in the commit under review.

```
$ git show a5d550e:task-management/lib/dispatch/backend.mjs | grep -n preferIdle
26: * `idle` is NOT in this list. It is opt-in through `dispatch.preferIdle` (or `--backend idle`),
80: * `dispatch.preferIdle` moves `idle` to the front — hand ready work to an agent that is already
90:  if (dispatch.preferIdle !== true) return base;
```

Three occurrences, including the predicate itself. The "what is NOT in it" section
listed it from expectation rather than from the diff.

## A third defect the review missed entirely — census trusted for liveness

The review praised the census check (`!census.stale`) without noting that a
*fresh* census is still only a hint: `staleAfterMs` is 45s off the supervisor's
slowest rung, and a pane can exit inside those 45s. `a5d550e` wrote the assignment
on the strength of that document alone. `8631f2b` re-proves the six-tuple binding
against a live `listServerPanes` **inside the same `withLock` section as the
write** (`management.mjs:437-439`, `bindingKeys` at `:78`), which is the discipline
`observeWorker` already applied to dispatched workers.

## What the review did get right

The double-assignment invariant. `assignTaskToAgent` really does load, assert,
read the census, filter and write inside one `withLock(assignmentLock(ctx), …)`,
and that has not changed at `8631f2b`.

## The lesson, stated so it is not re-learned

This review read for *whether the named hazard was handled* and stopped when it
was. It did not read for hazards nobody had named. A source review reports what it
verified and what it only read — those are different words and this document used
neither.
