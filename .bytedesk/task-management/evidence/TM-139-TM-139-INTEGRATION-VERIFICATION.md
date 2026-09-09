# TM-139 integration verification — lead session, 2026-09-09

Merged as `7dcb437`. `main` gates: unit **431 tests / 427 pass / 0 fail / 4
skipped**, topology **256/256**, build and roadmap green, both frozen presence
validators pass unmodified.

## The fix, and the proof no caller depended on the old behaviour

`absolutize(path, base = process.cwd())` evaluated its default on every call
where `base` was `undefined` — including the absolute-path branch that never
reads it. Resolved lazily, on the relative branch only.

The worker **proved** rather than inspected: 20 call sites enumerated, then both
implementations run over every argument shape those sites can produce (8 path
forms × 4 base forms). Only divergence is `base === null` with a relative path,
where the old code threw a `TypeError` (a default parameter fires on `undefined`,
never on `null`) and the new one falls back to the cwd. Nothing can depend on a
`TypeError`. `base === undefined` and `base === ""` are byte-identical and cover
every real site.

## Two things the fix created or exposed, both handled rather than shipped

1. **The fix turned a crashing daemon into an immortal one.** Once it stopped
   dying on `uv_cwd`, a supervisor whose repo had been deleted simply spun
   forever. The tick now `stat`s its consumer and retires with
   `state: "consumer-gone"`. The worker caught this by noticing stray processes
   accumulating during its own runs — not by reasoning about the change.
2. **The debris source was a regression TM-127 introduced, not a pre-existing
   one.** `send` self-starts a supervisor as of 0.7.0, and
   `tests/unit/topology-mailbox.test.mjs` shells `cli.mjs send` with no
   `AGENT_ORCHESTRATION_STATE_HOME` — so **every unit run spawned a real
   background daemon into the developer's own `~/.local/state`**, with a cwd that
   teardown then deleted. That is the whole mechanism. State home pinned, and a
   `reap()` helper now waits for a daemon to be gone before its directory is
   removed.

That second one is worth stating plainly: **the integrator's own TM-127 merge
shipped a daemon leak into every test run**, and it was found only because the
logging added in the same commit finally made a silent death visible.

## Verified by the integrator, not accepted

- A full unit run now creates **zero** new supervision records — 16 before, 16
  after.
- Sixteen stale records and **one leaked pre-fix daemon** whose repo no longer
  existed were reaped. It could never have retired itself: it was running code
  older than the retirement logic.
- `supervision.mjs` auto-merged; confirmed it carries **both** the census tick
  (`takeCensus`) and the TM-139 retirement (`consumer-gone`, `first_tick_at`).

## Two merge mistakes I made and caught by running the code

The test file conflict was rebuilt from the two intact sides. My first attempt
unioned the conflict hunks in place, which **cut a test in half and produced a
syntax error**; my second dropped the `reap()` helper the appended block depended
on, giving `ReferenceError: reap is not defined`. Both were invisible in the
diff and obvious the moment the file ran. Reading a merge is not verifying it.
