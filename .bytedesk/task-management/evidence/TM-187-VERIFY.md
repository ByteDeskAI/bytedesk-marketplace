# TM-187 — verification and fix

**Verdict: the filed hypothesis was a symptom. The root cause is one step upstream, and it affected
both the lead and the reviewer.**

Measured at HEAD `1668292`, working tree carrying only the five files in this change
(`git status --porcelain agent-orchestration/` = the 5 modified files, plus untracked
`.claude/` and `.ignore`). One unrelated commit landed mid-work (`1668292`, TM-180) and touched only
`task-management/CHANGELOG.md` — nothing under test.

## What was actually wrong

`expires_at` and the host's own wait deadline were computed from the SAME expression:

| file | probe expiry | wait deadline |
|---|---|---|
| `lead.mjs` | `Date.now() + ackTimeoutMs` (line 150) | `Date.now() + ackTimeoutMs` (line 159) |
| `reviewer.mjs` | `Date.now() + timeoutMs` (line 221) | `while (Date.now() <= probe.expires_at)` (line 239) |

So at the instant the wait gave up, the probe was already expired — and the very next statement
deleted it (`sweepExpired` in the lead; the `expired` test in the reviewer's `finally`, which was
therefore true **by construction** on every timeout). The TM-161 late-ack window was ZERO-WIDTH in
both halves, which is why the fix had unit tests, was correct, and changed nothing on a live pane.

Three comments asserted the opposite. `lead.mjs:169` — "the probe now OUTLIVES this wait".
`reviewer.mjs:250` — "Only a probe that was ANSWERED, or one nobody can answer any more, is removed
here". Rule 4 of `verification-that-can-fail.md`: prose in a comment is a claim about intent.

The orphan-ack discard I filed the task on is real, but downstream: it is what happens to the ack
after the probe has already been destroyed.

## How it was verified — the control, not the green run

`AO_LEAD_ACK_GRACE_MS=0` reproduces the old arithmetic exactly, so each new test has a run in which
it must fail:

```
# with the fix
ok 21 - a probe outlives its own wait, so a lead can still answer at its next turn boundary
ok  8 - a reviewer probe outlives its own wait, so a mid-review reviewer can still answer

# AO_LEAD_ACK_GRACE_MS=0 (the old behaviour)
not ok 21 - ... the probe must survive the wait for a late ack to be possible; found []
not ok  8 - ... the probe must survive the wait; found []
```

`found []` is the value, not the bit (rule 9): the assertion reports WHICH files survived, so an
empty probe directory names itself instead of hiding inside a boolean.

The live incident that started this — `lead ack 65db9a2b…` returning `{"ok":true}` against a probe
that vanished a second later with `fd2b831f.answered.json` untouched — is exactly this path: the ack
landed inside the window, the waiter had already gone, and the sweep took the probe with it.

## The change

- `delivery.mjs` — `LATE_ACK_GRACE_MS` (env `AO_LEAD_ACK_GRACE_MS`, default 120s): how much longer a
  probe lives than the host waits for it. One constant, imported by both halves, because a value
  fixed in one caller and not its sibling is the failure this repo keeps re-finding (rule 3).
- `lead.mjs` — probe minted at `ackTimeoutMs + LATE_ACK_GRACE_MS`, carrying `waited_until` so the two
  numbers are legible on disk; `sweepExpired` removes a probe's `.ack.json` together with the probe,
  so no orphan is left for a later pass to drop; the discard in `lateAck` now logs the nonce and says
  whether the probe had expired or was already swept; the duplicated `rememberAck` is gone.
- `reviewer.mjs` — same grace, and the wait loop is bounded by a separate `waitUntil` so the
  `finally`'s `expired` test can now be false, as its comment always claimed.

## Acceptance

1. **Met** — an orphan ack is refused with a reason naming the nonce, never dropped in silence.
2. **Met** — `lateAck` takes the caller's `log`; the discard says which branch fired and why.
3. **Met, though the AC described the symptom** — the reproducing tests are the two above, which fail
   against the pre-fix arithmetic. The probe-already-swept case is covered by the orphan test.
4. **Met** — `sweepExpired` and `lateAck` now agree: whoever removes a probe removes its ack.

## Suite

`node --test --test-concurrency=1 tests/unit/*.test.mjs` → **634 pass, 0 fail, 4 skipped** (the four
are Windows-only, skipped on this host), 81s. Concurrency 1 per `.claude/rules/tmux-test-isolation.md`.

## Not done here

No commit, no version bump. `agent-orchestration` carries an ecosystem semver
(`package.json` 0.2.0, `src/mcp.mjs` 0.2.3) so `.claude/rules/version-enforcement.md` requires a bump
plus a CHANGELOG entry in the same commit that ships this.

## Left open, deliberately

`reviewer.mjs:216` deletes both files BEFORE testing `mine`, where the lead's equivalent `continue`s.
With one reviewer per repository that only discards a previous incarnation's leftovers, so it is not
this bug — but it is the same shape and worth its own task if reviewers ever become plural.
