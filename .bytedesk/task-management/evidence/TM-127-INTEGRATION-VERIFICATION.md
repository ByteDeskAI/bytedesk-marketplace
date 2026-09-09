# TM-127 integration verification — lead session, 2026-09-09

Merged `tm/TM-127-agent-orchestration-persistent-repository-leads-` @ `d79db04`
into `main` as `ebc92e3` (--no-ff). This records what the INTEGRATOR verified
independently, not what the worker reported. A worker's self-reported done is
not accepted on its own (TM-129 AC1).

## Gates — run by the lead session on the branch before merge

| Gate | Result |
|---|---|
| `npm run test:unit` | **387 pass, 0 fail, 4 skipped** (391 tests, 3 suites, 9.5s) |
| `npm run test:contract` | **4 pass, 0 fail** on real tmux (15.3s) |
| `npm run build:check` | pass |
| `npm run roadmap:check` | `ROADMAP OK: 55 tasks, 96 unlocks, 6 goals, 7 trajectories, 7 gaps` |
| `python3 topology/fixtures/presence-v1/validate_presence.py` | `ok — 7 snapshot(s) conform to Presence v1 (contract revision 3)` |
| `python3 topology/fixtures/presence-v1/test_validator.py` | `all negative tests pass` |

Baseline on `main@82eaf62` was 275 tests / 271 pass / 4 skipped. No regression.

**Both presence validators pass UNMODIFIED and `git diff --stat f3f21e7..d79db04
-- topology/fixtures/presence-v1/` is empty** — the frozen, countersigned
contract was not touched. That was the stated failure condition: if either
script had needed editing, the change had leaked into the contract.

## The four coordinator reviews, checked against the committed tree

The reviews were written against the older UNCOMMITTED tree. Every one of them
is already fixed at `f3f21e7`; the branch needed no Phase 0 code change, and
`lead.mjs` has a zero diff, as required.

- **R01 lockfile** — ownership `token`, `.remove` gate, `process.kill(pid,0)` +
  `/proc/<pid>/stat` starttime + `boot_id`, `removeOwned(path, token)` on both
  reclaim and release, header states "elapsed time is never proof". The
  `continue`-spins-forever bug is gone: every branch reaches the deadline check.
  8 adversarial tests.
- **R02 prompts** — `composePrompt` iterates `["defaults","global","repo"]`
  (`prompts.mjs:98`), so the two resolvers no longer disagree about layer count.
  The silent `??` fallback is gone; a configured-but-unreadable file emits a
  `missing[]` entry with its errno (`prompts.mjs:61`). `generatedPrompt` no
  longer claims access it cannot grant.
- **R03 startup** — `isCandidateSession` is **gone** (0 occurrences); the watcher
  filters on provider process and cwd, never a session name
  (`startup.mjs:292`), which was the whole point of the watcher. The lease IS
  fenced (`startup.mjs:291,304`). Settings writes are compare-and-swap
  (`startup.mjs:100`), so install is no longer destructive to siblings.
- **R04 shared admission** — `mailbox.mjs:141`
  `const external = !sourceProject || !(await sameProject(sourceProject, destination))`,
  so an omitted source cannot bypass cross-repo admission whether or not the
  optional `--from-project` router was installed. 8 tests in
  `topology-shared-admission.test.mjs`.

## Versionless invariant held

`.claude-plugin/plugin.json` gained only `experimental.monitors` and **no
`version` key**; the `marketplace.json` entry is still versionless. The `0.7.0`
in the diff is `package.json`, which is this plugin's only ecosystem semver
marker. `experimental.monitors` is not inferred — it is exactly what the sibling
`task-management` plugin declares, and that plugin's monitors demonstrably run.

## What this merge does NOT prove

Named explicitly so nobody reads the green gates as more than they are:

1. **Automatic idle wakeup is still untested in the live sense.** The supervise
   tick now runs, but delivery still reports `durable-pending` and rings nothing
   — that is TM-130's scope, not a TM-127 regression.
2. **The gateway terminal header is unproven end to end.** The SDK direction is
   decided (ADR-0010) but the contract extension and producer are TM-136/137/138.
3. **`"when": "always"` process behaviour under many worktrees** was measured by
   the worker, not by me; see its report on TM-127.
4. No push to `origin` has been made. Consumers of the marketplace receive
   nothing until `main` is pushed.

## Addendum — worker claims checked by the integrator after merge

Three claims from the worker's report mattered enough to verify in the tree
rather than accept. All three hold.

**1. The crash-loop hazard, and its fix.** Under `"when": "always"`, losing the
per-repo lock originally threw `TOPOLOGY_LOCK_TIMEOUT` and exited non-zero. A
monitor host reads a non-zero exit as a crash and restarts — so on a machine
with N linked worktrees, N-1 losers would have become N-1 restart loops. That is
the mechanism that actually produces "why are there 40 node processes", and it
would have been *caused* by this phase's own monitor registration. Fixed and
verified at `topology/cli.mjs:263-264`:

```js
if (error?.code !== 'TOPOLOGY_LOCK_TIMEOUT') throw error;
return out({ ok: true, supervising: false, reason: 'another-supervisor-owns-this-repository', consumer: ctx.consumer });
```

Worker's measurement, 8 real linked worktrees racing simultaneously: every
worktree resolved to the same canonical repo id, **1 of 8 supervisors alive
after 5 s**, seven exited 0 with that reason. The 100 ms lock wait was left as
is, since all seven were gone well inside the sample.

**2. The presence heartbeat can no longer be widened by accident.** Verified at
`topology/lib/presence.mjs:180-182` — the bound is asserted at producer
*construction*, not documented in a comment:

```js
const publishIntervalMs = Math.floor(staleAfterMs/3);
invariant(publishIntervalMs>0 && publishIntervalMs*3<=staleAfterMs, "TOPOLOGY_PRESENCE_BOUNDS", …);
```

`watch()` reads `publishIntervalMs` rather than recomputing, so the only way to
widen the contract heartbeat is to change that one value — and doing so throws
before a single snapshot is published.

**3. The contract file is byte-identical to what Gateway countersigned.**
Verified by the integrator, not reported:

```
3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5  topology/PRESENCE-CONTRACT.md
3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5  PRESENCE-CONTRACT.md   (evidence/TM-128-CONTRACT-HASHES.txt)
```

The worker additionally re-hashed all 10 committed fixtures against that
evidence file and reports all 10 matching.

**4. Versionless invariant, independently confirmed.** `plugin.json`'s entire
diff is the three-line `experimental.monitors` key; no `version` in either
manifest; `.claude-plugin/marketplace.json` has an empty diff. Worker also ran
`claude plugin validate ./agent-orchestration`, which passes with exactly the one
expected `"No version specified"` advisory — that warning is the proof the
plugin still resolves to a commit SHA, and following it would pin the plugin.

## Consequence for the wave-1 branches

`d79db04` touches `topology/cli.mjs` (+42) and `topology/lib/supervision.mjs`
(+128), two of the three integrator-reserved files. The three wave-1 branches are
cut from `f3f21e7` and are therefore one commit behind on both. All three workers
were told to read those files from `main` before writing their patch files, so a
patch is never authored against dead code. `topology/lib/tmux.mjs` is untouched.
