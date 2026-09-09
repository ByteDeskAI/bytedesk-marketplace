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
