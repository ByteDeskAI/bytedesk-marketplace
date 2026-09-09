# TM-130 + TM-131 integration verification — lead session, 2026-09-09

`main` at `afb764b`. Merges: `c565312` (TM-130), the TM-131 feature merge,
`f077dc4` (pane_title), `afb764b` (supervision tick).

## Gates, run by the integrator on main

| Gate | Result |
|---|---|
| `npm run test:unit` | 427 tests, **423 pass, 0 fail, 4 skipped** |
| `npm run test:topology` | **252 pass, 0 fail** |
| `npm run build:check` | pass |
| `npm run roadmap:check` | `ROADMAP OK: 55 tasks, 96 unlocks, …` |
| presence validators | both pass **unmodified**, `fixtures/presence-v1/` untouched |

Baseline before this work: 271 pass on `main@82eaf62`.

## TM-130 — the rename found a bug that review did not

The task asked for a rename to resolve a name collision. Re-reading the ladder to
do it exposed that **the `resubmit` rung was unreachable in production**: the
driver gated *every* rung on `whenSafe`, which requires an empty composer, but
`typed-unsubmitted` is *by definition* a composer that is not empty. The one
state that asks for a resubmit could never satisfy the condition that would let
us fix it — every stuck draft would have gone straight to `stuck-in-composer`
without a single Enter being sent.

It read as correct in review, and **the unit test agreed with it**, because the
stub reported a composer that was empty forever. That is the same failure class
the whole task exists to eliminate: silent, plausible, and self-confirming.

Fixed by deciding the rung first and gating for what that rung actually does —
`retype` still requires an empty composer; `resubmit` uses a new `decideResubmit`
that drops the composer check and **nothing else** (pane alive, binding intact,
no attention or failure line, because pressing Enter at `❯ No, exit` is if
anything worse than typing there); `wait-safe` now *ends* the ladder when the
composer empties, since that is the draft leaving. The stub now behaves like a
real pane. Side effect: the ladder no longer spins, and that test file went from
22 s to 8 s.

Also in TM-130: `providers/codex.json`'s ready pattern fixed in **both** the tmux
and JS forms — measured live, the shipped pattern matches **0** lines on an idle
codex composer, which renders `› Ask Codex to do anything`, so every codex agent
was burning its full 30 s timeout. Its `notes` claimed a 2026-09-05 measurement
that did not survive re-measurement; corrected in place rather than left beside a
true one.

## TM-131 — two corrections to the plan, both empirical

**The braille sweep is not CLI-agnostic.** Measured across 46 live panes: claude
2.1 renders no braille at all and its pane title is a constant `✳ <task>` whether
busy or idle. The real discriminator is tense — `✻ Whirlpooling… (8m 45s · …)`
versus `✻ Worked for 12m 29s · done 3:36 AM`, same glyph. A detector built on the
glyph would read every idle claude pane as busy. **Reproduced independently by
the integrator** after applying the `pane_title` patch: of 44 live panes, all
return a title at zero extra tmux calls, five animate braille (codex), and the
claude panes show the constant `✳`.

**The quota anchor is empirical, not stylistic.** Four live kimi panes are
quota-blocked, and `%113` renders the 403 with **no `[provider.auth_error]`
prefix at all**. A pattern anchored on the full observed string would have
matched three and missed the fourth — and the fourth is this repo's own TM-127
session. The plan's tmux-format-parser argument is real but secondary.

**`activity` means the world moved, never that we looked.** Past eight agents the
capture budget rotates and flips panes `idle → unknown → idle` with nothing
happening, which would pin the backoff ladder as hard as a busy loop while
telling nobody anything. Transitions into or out of `unknown` therefore
contribute nothing.

## A worker error, corrected, and worth recording

TM-131 reported `build:check` failing at the base commit and concluded it was
pre-existing. It was not: the worktree had no `node_modules`. The worker's own
diagnosis of its method is the useful part — it had symlinked the main checkout's
`node_modules` into both its worktree and its `git archive` control tree, so
"both fail identically" meant only that both shared the confounder. **A control
that shares the confounder is not a control.** With a real `npm ci`, `build:check`
passes. The same fresh-worktree artifact hit TM-130 as five spurious unit
failures.

## Carried forward, not silently dropped

- TM-130 saw **one** unexplained `test:unit` failure in six runs *before* the
  ladder fix, with no `not ok` captured. Not recurring in five runs since; the
  removed spin is the plausible cause but this is **not proven**.
- `census.mjs` has no `undelivered` field yet; `undeliveredReport(runDir)` from
  `delivery.mjs` is the data source when that surface is wanted.
- The `send` ring wiring, `--no-ring`, `ack`, `! UNDELIVERED` and the inverted
  contract test remain as patch files under `docs/patches/`, because `cli.mjs` and
  the contract test are integrator-owned. **The delivery machine is merged but not
  yet wired into `send`.**

## Addendum — the delivery machine is now wired, and the guard was proven

`main` at `dcb4613`. The `send` ring, `--no-ring`, the optional `ack` verb,
`status`'s `! UNDELIVERED` banner, the `census` noun, the tmux socket seam and
the inverted contract test are all applied; `docs/patches/` is empty and gone.

**The regression guard was proven to fail, not asserted to work.** I asked for
this specifically, because a guard that cannot go red is the same bug the worker
had just found. It was demonstrated two ways, each restored cleanly afterwards:

1. **Ring disabled in the product** — the `ringMessage` call replaced with
   TM-127's exact `{ rang: false, notification: 'durable-pending' }`. **Three of
   four contract tests went red**, including line 85, printing the
   `durable-pending` payload verbatim.
2. **Fixture `composer` removed, ring intact** — also red, with
   `"adapter fake-agent declares no measured composer, so no ring can be proven
   safe"`. This is the case I flagged as not optional: it proves the fixture's
   composer is load-bearing rather than decorative, and that the guard cannot be
   made silently vacuous.

So the guard fails for the regression itself **and** for the thing that would
hollow it out.

**Three findings the contract tests produced, each of which changed code rather
than being asserted around:**

- `send` needs `--providers-dir` in these tests for the same reason `launch`
  already does — the doorbell resolves the recipient's adapter to read its
  measured composer, and the fixture adapter is not in the plugin's `providers/`.
  Confirmed harness plumbing, not a product gap.
- `respawn-pane -k` changes `pane_pid`, so the six-tuple guard fires and the ring
  refuses with `stale-binding`. Rather than route around it, that became a
  contract: the deaf-pane test asserts the refusal **first** — `stale-binding`,
  `rang: false`, **exit 0**, because a pane that is not ours is not a delivery
  failure — then rebinds the way `failoverAgent` does and goes on to prove
  `ring-failed`. The `%N`-reuse case is now covered for free.
- `deepEqual(rungs, ["retype"])` was flaky **by construction** and was removed:
  the fixture's inbox poller can win the race, and its reply path returns early
  without redrawing the prompt, so a `resubmit` may legitimately be needed. What
  is not a race, and is what the test now pins, is that the pointer is typed
  **exactly once** however many rungs it takes.

**Stated plainly, not laundered:** the `tmux.mjs` socket-prefix fix is a **seam,
not a proven repair**. `serverArgs` is extracted and threaded through
`ControlClient`, `waitForChannel` and `clearAndWaitForShell`, but **no caller
passes a `tmuxServer` yet**, so today's behaviour is byte-identical. Only the
pure part is verified (`serverArgs(null) → []`, `"mysock" → ["-L","mysock"]`,
`"/tmp/s" → ["-S","/tmp/s"]`). I took this fix knowing that; the risk is mine.

**Gates on `main`:** unit 427 / 423 pass / 0 fail / 4 skipped · topology 252/252 ·
contract 6 tests / 5 pass / 0 fail / 1 skipped (the design-client contract, which
needs the private registry — pre-existing) · `topology:tmux` 4/4 including all
three new and inverted contracts · build and roadmap green · both frozen presence
validators pass with `fixtures/presence-v1/` untouched.
