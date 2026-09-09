# Wave 2 integration verification — TM-132, TM-133, TM-136 — lead session, 2026-09-09

`main` at `75ee3dc`. Gates run by the integrator:

| Gate | Result |
|---|---|
| `npm run test:unit` | 464 tests, **460 pass, 0 fail, 4 skipped** |
| `npm run test:topology` | **289 pass, 0 fail** |
| `npm run build:check` / `roadmap:check` | green |
| both frozen presence validators | pass **unmodified** |
| `topology/fixtures/presence-v1/` | **untouched across all four merges** |

Session baseline was 271 pass on `main@82eaf62`.

## TM-132 — the worker refused an instruction, and was right

The brief said "vacate a holder that is not provably alive". That is a
**correctness bug for this primitive**. Liveness is tri-state — `true`, `false`
(listing succeeded, six-tuple absent) and `null` (listing failed) — and only
`false` may reclaim. Under the literal wording, one
`TOPOLOGY_TMUX_OBSERVATION_FAILED` would vacate a live holder and grant the same
`cutover` slot to a second agent, **violating the mutual exclusion the whole
primitive exists to provide**. Reclamation now requires proof of *absence*,
matching `lockfile.mjs`'s "unknown ownership fails closed" and the census's "a
failed capture is not an empty screen". The starvation defence is unaffected: a
dead pane in a readable listing is still `false` and still reclaimed.

Two further judgements the brief did not cover: a request with no resolvable tmux
binding is **refused** rather than queued, because an entry that can never be
proven alive or dead starves the queue forever; and the tick waits at most 250 ms
on a slot lock and skips, rather than blocking the supervisor.

`reconcile` is pure and returns the original object **by identity** when nothing
moved, which makes "reconcile twice is byte-identical" true by construction.
`failoverAgent` now re-stamps slot bindings, so a quota respawn no longer
silently forfeits an agent's slot.

## TM-133 — the trap test was proven non-vacuous

The worker reverted its own branch to `if (external)` and re-ran the trap test,
reproducing the exact predicted failure — `Unknown agent "lead0001". Agents in
this run: conductor, alice, bob, rev.` — then restored. It also stated plainly
that it did **not** run the same ablation on the other nine tests. That
distinction between what was proven and what was merely observed passing is the
right kind of honesty and is why this is recorded.

Two accepted qualifications: **"before `external` is computed" is not literally
achievable**, since `external` is computed before `loadRun` yields the run and
the refusal depends on it — expansion sits after `external` and before the
external *branch*, which is the property the criterion actually wants. And a
**refused broadcast still burns a sequence number and persists an envelope** —
filed as TM-142, because the external-sender refusal is the adversarial path.

## TM-136 — three corrections to the plan

1. **`activity.state` has seven values, not five.** The plan wrote five, dropping
   `attention` and `unknown`. `unknown` is load-bearing: the census deliberately
   separates "the screen was empty" from "I could not read the screen", so a
   header coercing `unknown` → `idle` would be **confidently wrong every time the
   capture budget rationed a pane**.
2. **The frozen validator would not have caught the `mailboxDepth` narrowing.**
   Its exclusion check tests top-level agent keys, so a `messages` array nested
   inside `mailboxDepth` passes clean. Dropping it is therefore **producer
   discipline with no automated gate** — which is precisely why it is written
   into the addendum rather than assumed.
3. **`queueDepth` returns `oldest_age_ms`, not `oldestAgeMs`** — a rename TM-138
   must perform, not a pass-through.

It also verified the stronger form of the additive-keys argument against the real
consumer: the Go parser on `origin/tm/TM-222-…` decodes into `map[string]any`,
never calls `DisallowUnknownFields`, and its only key-presence test is the same
ten-name list.

## What is NOT done

**TM-136 AC7 — the gateway coordinator's countersignature — is external and
cannot be satisfied from this repository.** The request is written and committed
at `topology/HEADER-EXTENSION-COUNTERSIGNATURE-REQUEST.md`. TM-138 (the producer
implementation) must not start until it is signed. TM-136 is therefore blocked,
not done.
