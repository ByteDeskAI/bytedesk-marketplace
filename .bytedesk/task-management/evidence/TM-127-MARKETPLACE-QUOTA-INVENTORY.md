# TM-127 — provider-blocked. Exact gap inventory at the block.

Marketplace Claude %3, coordinator. 2026-09-09.
Cause: Kimi provider 403, five-hour usage limit (KIMI-QUOTA-BLOCK.md). Not a task failure.

**No provider substituted, no quota purchased, no partial merge, nothing cleaned up.** Awaiting the
operator's decision on Claude/Codex fallback versus waiting for Kimi reset.

## Preservation — done

- **Sessions alive and untouched.** `%113` (`ao-marketplace-kimi-tm127-20260909`, `kimi-code`),
  and Gateway's `%116`/`%117`, all report `pane_dead=0`. Nothing reaped.
- **Worktree untouched**, on `tm/TM-127-agent-orchestration-persistent-repository-leads-` at base
  `82eaf62`.
- **Snapshot taken outside the tree**: `TM-127-partial-snapshot-20260909.tar.gz`, 23 entries, 56K,
  sha256 `2e0fa09f1a599a4b…`. This matters because **nothing is committed** — all ~3,800 lines exist
  only as uncommitted working-tree state. Losing that directory loses the work.
- Task claim and ownership left with the worker.

**Recommended, not done:** a WIP commit on the worker's own feature branch would make this durable
without merging anything. I have not done it — it changes state another session owns, and it is
reversible with `git reset --soft` if the worker prefers to arrange its own commits. Operator's call.

## What exists — 22 files, ~3,800 lines, all uncommitted

New: `topology/lib/{lead,reviewer,startup,prompts,config,lockfile,repoid}.mjs`,
`config.defaults.json`, `prompts/{common,lead,reviewer}.md`, and five unit test files.
Modified: `topology/lib/{agents,mailbox,routing,providers}.mjs`, `providers/claude.json`,
`package.json` (adds `config.defaults.json` and `prompts` to the published `files` array — correct
and necessary for packaging).

## Test state — READ THIS CAREFULLY, it is two different things

Partial tree: **267 tests, 256 pass, 7 fail, 4 skipped.** Baseline `82eaf62`: 275/271/0/4.

The seven are not seven regressions.

**Five are environmental, not the worker's doing.** `mcp-contract`, `runtime-engine`,
`service-routing`, `session-host` and `session-supervisor` fail to load with
`ERR_MODULE_NOT_FOUND: Cannot find package '@modelcontextprotocol/sdk'`. **The worktree has no
`node_modules`** — it is gitignored, so a fresh worktree never gets one. Control: the same file
passes in the main checkout, which does have `node_modules`. These five would fail identically on an
untouched worktree of `82eaf62`. **Not attributable to the worker.** Whoever resumes should run
`npm ci` in the worktree before drawing any conclusion from a test run.

**One is a real, valuable failure — and it is the worker's own test:**

```
not ok 248 - two concurrent watchServer ticks: exactly one acquires the lease and labels
  AssertionError: one watcher per server — 2 !== 1
```

That is `topology-startup.test.mjs:255`, written by the worker, and it independently confirms
**review 03 finding 4**: the watcher lease has no fencing, so two watchers can hold it at once. The
worker wrote the test that catches its own defect and had not yet fixed it when quota hit. That is
the process working, not a problem.

The seventh entry in the summary count is a file-level rollup; I isolated six named `not ok` lines
and did not pin the rollup, so I am reporting the count as observed rather than inferring it.

## Acceptance criteria — honest status

Tests on partial source do not prove completion. Nothing below is claimed as met.

| AC | Subject | Status |
|---|---|---|
| 1 | Lead identity, `lead status/ensure/assign`, three-state liveness | **partial** — `lead.mjs` exports `leadState`, `ensureLead`, `assignLead`, `detachLead`, `leadNonceAck`, `readLeadRegistration` |
| 2 | Serialized creation, recursion guard, dead vs unresponsive | **partial, defects open** — `lockfile.mjs` under review 01; four findings, seven required tests |
| 3 | Create-dedicated / assign-existing, handshake, no killing external panes | **partial** — `assignLead`/`detachLead` present, unverified |
| 4 | Startup check: hooks + managed launch + watcher | **partial, defects open** — `startup.mjs` under review 03; nine findings, eleven required tests, one already red |
| 5 | Standing inbox/outbox, durable holds, resume | **partial** — `mailbox.mjs` modified, unverified |
| 6 | `routeMessage` shared admission no longer fails open | **partial** — `routing.mjs` modified, unverified |
| 7 | Global + repo config, templates, `agent new --template` | **partial** — `config.mjs`, `config.defaults.json`, `prompts/` present |
| 8 | One resolver used by every path | **partial, defects open** — `prompts.mjs` under review 02; five findings |
| 9 | Watch config, refresh, ack, restart-required, last-valid on bad config | **partial, defects open** — applied-state split exists; fail-safe path unreachable (review 02 finding 5) |
| 10 | Unit + tmux contract tests, gates, clean install launch | **partial** — five test files added; suite is RED |
| 11 | Docs: CLI, skills, config, topology | **not started** — zero doc/CHANGELOG changes |
| 12 | Presence producer + fixtures | **NOT STARTED** — no `presence.mjs`, no `topology/fixtures/`. Contract frozen and available; this was unblocked shortly before the quota block |
| 13 | Lead manages lifecycle through the task store | **unknown** — no evidence found |
| 14 | Dedicated persistent reviewer, provider-constrained | **partial** — `reviewer.mjs` exports `ensureReviewer`, `reviewerAvailability` |
| 15 | Unavailable reviewer fails closed | **partial** — `reviewEligibility`, `currentReviewStatus` present, unverified |
| 16 | Worker communication protocol enforced mechanically | **unknown** |
| 17 | Lead status relay, never inject into a composer | **unknown** |
| 18 | Review queued per task; edits invalidate prior revision | **partial** — `recordReview`, `latestReview`, `currentReviewStatus(consumer, task, currentRevision)` suggest revision pinning is modelled |
| 19 | Verified-merge-only cleanup, ordered, blocked-cleanup reason | **unknown** |
| 20 | Crash recovery, no silent claim stealing | **unknown** |
| 21 | Auto-merge after independent exact-revision review + checks | **unknown** |

Roughly: 12 of 21 have identifiable partial implementation, 1 is confirmed not started, 1 has no
work, and 7 have no evidence either way. **Zero are complete**, because none has passed independent
exact-revision review and the suite is red.

## Coordinator work that continues without the provider

Read-only, no source edits:

- Reviews 01 (lockfile), 02 (prompts) and 03 (startup) are delivered and open — 18 findings and 25
  required tests between them. That is the worker's queue on resume, whichever provider resumes it.
- I can review `lead.mjs`, `reviewer.mjs`, and the `mailbox.mjs`/`routing.mjs` changes next; none has
  been reviewed yet, and all three are substantial.

## Gates that remain in force

Automatic merge is authorized **only** after complete implementation, independent exact-revision
review, and required checks. None of the three is satisfied. All reviews so far are against an
uncommitted tree and none counts toward the merge gate. **No partial merge under any circumstance.**

— Marketplace Claude, pane %3
