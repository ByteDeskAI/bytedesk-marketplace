# TM-140 + TM-141 integration verification — lead session, 2026-09-09

Merged `73536a1` (salvaged from a crashed session's uncommitted worktree, committed
as `14b3ecd`). Peer fix `181f862` and hardening `8beb169` on top.

## Gates

`node --test --test-concurrency=1 tests/unit/topology-*.test.mjs` →
**294 tests, 294 pass, 0 fail, 0 skipped.** Contract suite **4/4**.
Serial concurrency is required: the parallel run was OOM-killed (exit 137).

## TM-140 — two surfaces, one failure semantics

`lead ensure|assign` called `startRepositorySupervision` directly and threw when
supervision could not start, while `role assign lead` — the same operation
through the other surface — degraded via `ensureSupervision`. Both degrade now. A
repo that cannot start a supervisor publishes stale presence: degraded, not a
failed command. A test drives **both** surfaces and compares, so they cannot
drift again.

## TM-141 — decided, not patched

Exactly **one** failure is transient: tmux could not be enumerated. It now skips
the tick instead of ending `superviseRepository`. `restarts` is what `doctor`
reads to identify a crash loop, so a flaky tmux must never increment it; a
supervisor that is up and not reconciling shows as `SUPERVISOR_STALLED`, because
the tick record is deliberately not rewritten on a degraded tick and
`tick_age_ms` keeps growing. Every other throw stays fatal, and `once` still
throws — a one-shot has no next tick to degrade into, so the failure is its
answer.

The L1 heartbeat gets the same treatment: not publishing is still the right
answer to a failed listing, because presence must not state liveness it could not
observe, but it is a **one-beat** answer.

The asymmetry between the two listings is preserved: the reconcile listing
belongs to presence and abandons the whole reconcile; the census's own listing is
absorbed and still yields a document with every agent `unknown` and nothing
dispatchable.

## INCIDENT — caused by the test file that arrived with this work

`topology-supervision-consistency.test.mjs` shipped with:

```js
t.after(() => run('tmux', ['kill-server'], { env, allowFailure: true }));
```

`env` set `TMUX_TMPDIR`, which looks isolated, but it **inherited `$TMUX`** from
the operator's shell — so the client addressed the operator's server. The
teardown killed it. **37 live agent sessions were destroyed at 21:07:51**,
including the gateway swarm. Files were not affected; every repository working
tree was verified intact. What was lost is running sessions and their
conversation context.

Fixed by a peer session in `181f862` (blank `TMUX`, pass `-S <socket>`). The
integrator then audited every tmux teardown in the suite: six were already
socket-scoped, one contract teardown remained bare and — though genuinely env
isolated and therefore not the cause — was hardened in `8beb169` so the same
mistake cannot be reintroduced by an edit to a distant env literal.

The integrator merged this test after reviewing its diff, and did not catch it. A
bare `kill-server` in a teardown is precisely what review is for.
