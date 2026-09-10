# TM-161 / TM-160 — closing evidence

Merged at `5ef6202` (caller fix) on top of `8be9365` (library fix). This file separates what the
integrator verified in the canonical checkout from what the worktree author measured on live panes,
because they are different claims and only one of them is mine.

## Verified by the integrator, in the canonical checkout

| gate | result |
|---|---|
| `npm run test:topology` | exit 0 — 364 tests, 364 pass, 0 fail |
| `npm run test:unit` | exit 0 — 541 tests, 537 pass, 0 fail, 4 skipped |
| `npm run build:check` | exit 0 |
| `npm run roadmap:check` | exit 0 |
| merge content present at HEAD | `cli.mjs` ack-timeout handling and `startup.mjs` `ackTimeoutMs:0` both confirmed in the committed tree |

Read directly in the diff before merging, because the claim depends on it: the `ackTimeoutMs <= 0`
guard sits **after** `recentAck` and `lateAck` in `defaultResponsive`. A readiness screen therefore
still answers from proof already on disk and returns unproven only when there is none. "Cached proof
only" is accurate rather than "always false".

## Measured by the worktree author on live panes — reported, not reproduced here

Same repository, isolated socket, teardown verified to zero.

- Before the caller fix: three consecutive `unresponsive` reads; the probe file appearing and gone
  within about five seconds against a nominal 150-second window.
- After: `responsive` on the **first** ask; both roles responsive after the screen change.
- Delivery: `ring: scribe | submitted | submitted` with the reply in the outbox, where the pre-fix
  run reported `stuck-in-composer` with the reply already written (TM-160).

The integrator did not run a live pane. These rows are the author's measurements, recorded as such.

## The defect, in one line each

- `cli.mjs` passed `Number(flags['ack-timeout'] || 5000)` on every `lead` call, so the library
  default — raised to 30s and made env-configurable precisely because a probe must fit a model turn
  — was never consulted, and a probe expired before the agent's next turn boundary.
- `startup.mjs` passed a hardcoded `1000`. It now passes `0`: that path is a SessionStart screen for
  every session on the machine and cannot wait for a model turn, so it asks rather than interrogates.

## Why the suites did not catch it

The unit suite passed in both states. It exercises the library directly and never goes through
either caller's argument construction — the same reason the `lateAck` tests passed while the path
around them was broken. Recorded as section 6 of `.claude/rules/verification-that-can-fail.md`:
a default a caller hardcodes past is not a default.
