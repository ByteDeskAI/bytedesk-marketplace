# TM-165 — the suite was deterministic; the checkout was not

## The finding, first

**The topology suite is not flaky.** The non-determinism this task was opened for was
**tree contamination**: the measurements were taken in the shared main checkout while
another session held 48 uncommitted files in it. I was measuring their unfinished feature
and reporting it as a property of main.

That is a fourth cause of apparent flakiness alongside load, ordering and timing
assumptions, and it is the one that most looks like a defect in your own code — a real
failure, reproducible while it lasts, in a file you did not touch.

## AC 1 — characterised, with a reproduction rather than a guess

| tree, commit `d97c9de` | `topology-mailbox.test.mjs` |
|---|---|
| clean worktree | **10/10 pass** |
| same worktree, the other session's WIP copied in | **5/5 fail** |

The reproduction *is* the contrast. Traced to two `listServerPanes` calls their WIP added
to every CLI command (`cli.mjs:1342 main` → `watchServer` at `startup.mjs:276`, and
→ `owned` at `cli.mjs:284` → `reconcile` → `collectPresenceAgents`), one of them scoped
to the operator's default tmux server. Reported on TM-164; not mine to fix. The
integrator confirmed both halves independently before acting.

**Not load, not ordering, not timing.** Verified negatively too: the failure did not
reproduce under 8 busy cores in a clean tree, which is what ruled load out rather than an
argument that it was not load.

## AC 3 — both distributions, ten samples

Dedicated worktree at `fcac6a9`, nothing else touching it, `node_modules` resolved,
`--test-concurrency=1`.

| condition | runs | fail counts | verdict |
|---|---|---|---|
| idle | 5 | 0, 0, 0, 0, 0 | stable |
| loaded (8 busy cores, load avg **89**) | 5 | 0, 0, 0, 0, 0 | stable |

Pre-merge, in the same clean conditions, the idle set was 552/557 **five times with the
identical single failure**. The suite went from consistently-one-red to clean without
passing through a flaky phase — itself evidence the failure was deterministic.

**Population, stated because it is not the only one.** This worktree contains none of
TM-164's in-flight files. The integrator measured main-plus-WIP six times each way and
found a ~1-in-6 intermittent — *"the supervisor records where it went and how often it has
been restarted"* — present **with and without** the merge resolution, so it belongs to
their work in progress. These numbers cannot see it, by construction. The two sets must
not be pooled: this measures main; theirs measures main-plus-WIP.

## AC 2 — the suite now reports its own instability

`tests/stability.mjs`, `npm run test:stability`. It separates **consistently failing**
from **passed some runs, failed others**, exits **2** for instability specifically so a
caller checking only "did it pass" cannot read one lucky green as health, and prints the
uncommitted paths before the numbers — it refuses to describe a dirty tree as a
measurement of a commit.

## What the clean measurement exposed, which was worth more than the flakiness

1. **`topology-supervision.test.mjs:197` had been red on main since `1de163b`.** Bisected,
   not reasoned: green at `1de163b^`, red at `1de163b` ("quiet the supervise daemon in the
   console"). That commit stopped the daemon streaming ticks to stdout — correct — but the
   test's only signal was grepping stdout for them. Its failure text read `it said
   instead:` followed by nothing: a reason built from an empty stream.
2. **A unit test's supervise daemon was watching the operator's tmux server.** That file
   built its env literal five times and **not one blanked `TMUX`**. An instrumented run
   wrote a watcher record for `serverKey /tmp/tmux-1000/default` and pending enrollment
   records for `assets/.git`, `bytedesk-remote-gateway/.git` and `bytedesk-board/.git` —
   three unrelated real repositories, enrolled by a unit test. Read-only, which is luck
   rather than design. All five sites now share one `isolatedEnv()` helper. Verified by
   contrast, not by the green: the same probe now writes six state files, all for its own
   temp repo, and no watcher record at all.
3. **`.gitignore` had `node_modules/` with a trailing slash**, which does not match a
   symlink — so the ordinary worktree setup read as a dirty tree.

## What I got wrong, because it is the useful part

- Reported this test as "deterministically red on main, 3/3 in isolation". Wrong: "in
  isolation" had meant *one file instead of the suite*, never *this commit instead of
  somebody's unfinished feature*.
- **Nearly shipped a fix for it.** I rewrote the assertion to permit tmux reads and forbid
  only `send-keys`, with a confident comment explaining the invariant was stale. It passed
  3/3 and would have merged green while deleting the guard that caught a real regression.
  What stopped it was making the check able to fail informatively — printing *which*
  subcommands ran, which returned `nothing`, an answer in neither of my theories.
- First "clean" measurement showed 5 failures. Not flakiness — no `node_modules`. My
  control introduced the confounder, exactly as in `build:check`.
- **Contaminated my own measurement** by checking out a different commit under the
  worktree a stability run was executing in — ten minutes after documenting that mechanism
  as §8.
- Reported a merged test file as "14/14 pass" from **one run**, inside this task. The
  integrator ran six and found the ~1-in-6 above.

Rules §7 and §8 in `.claude/rules/verification-that-can-fail.md` are the durable form of
the first two.

## Verified vs read

**Verified (ran it):** all ten stability runs; the 10/10-vs-5/5 contrast; the `1de163b`
bisect in worktrees at both commits; the enrollment-record contrast before and after
isolation; `topology-supervision.test.mjs` 12/12 after the fix.

**Read, not verified:** the integrator's six-and-six figures are theirs, reproduced on
their machine state, not re-run by me. I have no independent measurement of the ~1-in-6.
