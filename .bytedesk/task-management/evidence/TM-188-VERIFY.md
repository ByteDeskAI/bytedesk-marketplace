# TM-188 — pool card and readiness reasons on the dashboard

Branch `tm/TM-188-task-management-pool-card-and-readiness-reasons-`, worktree
`.bytedesk/worktrees/TM-188-…`, baseline commit `edd9a93`. Tree clean apart from
`.claude/settings.json`, which another session's graft tooling modified before this work started
and which is **not** part of this commit.

## What was verified, and what was only read

Every number below was produced by running the thing. Where a check could have passed while the
code was wrong, the control that rules that out is named.

## AC1 — the pool card

`GET /api/pool` (the object `tm pool status` prints, unchanged by this task) drives a card at the
top of `/sessions`: state, `workers / poolWip`, the ready count, the poll interval, the idle-exit
and the log path.

Verified in a browser against a live `tm-dashboard` on a scratch store at `/tmp/tm188-demo`, not
against this repository's board — the toggle stops a real pool, and three workers were running
here at the time.

| screenshot | what it shows |
|---|---|
| `TM-188-pool-card-running.png` | `running (pid 3374863)` · `0 / 3 working` · `1 ready` · `started 0m ago` · `polls every 30s · exits after 60m idle · …/pool.log` |
| `TM-188-pool-card-paused.png` | `paused` with the reason read from `pool.state.json`: `3 dispatch failures in a row: backend 'tmux' exited 1 — 3 failures in a row; \`tm pool resume\` clears it` |

The paused state was picked up **without a reload**: the card refetches on the store's 15 s `now`
tick, which is shorter than the pool's 30 s default poll.

## AC2 — the toggle, both directions

Clicked in the browser, then checked on disk and in the process table rather than in the UI.

```
# ON
click .tm-sessions__pool input[role="switch"]
config.json  →  "dispatch": { "enabled": true }
GET /api/pool →  "running": true, "pid": 3228331        (applySettings → ensurePool, at once)

# OFF
click .tm-sessions__pool input[role="switch"]
config.json  →  "dispatch": { "enabled": false }
… one poll later …
GET /api/pool →  "running": false, "pid": null
ps -p 3228331 →  process 3228331 is gone
```

`ps` is the control: the API reporting `running: false` alone would also be true of a pool whose
pid file went stale while the process kept running.

**Nothing was dispatched.** Before toggling anything on, `tm pool once --dry-run` with the pool
enabled printed `skipped TM-003 — not ready: acceptance criteria`, and the only other candidate
(TM-001) is blocked, so `poolable` excludes it. The demo store had no dispatchable work by
construction.

## AC3 — readiness on the card and in the inspector

`boardPayload` now derives `readiness` per task from `readinessVerdict`, the helper `tm why`
already used — so the board shows the verdict the pool applies, with no request per card and no
second implementation.

`TM-188-card-readiness.png` — four cards, four verdicts:

| card | chip |
|---|---|
| TM-001 complete | `agent-ready` |
| TM-002 `ready-for-human`, person-triaged | `person's call: label ready-for-human` |
| TM-003 no criteria, hand-labelled `ready-for-agent` | `person's call: acceptance crit…` |
| TM-004 no criteria, auto-triaged | `not ready: acceptance criteria` |

TM-003 is the case worth keeping: the stored label says `ready-for-agent`, the live check says the
task has no criteria, and the card reports the live check — which is what the pool does with it.

`TM-188-inspector-readiness.png` — the same verdict in the task inspector, beside Start / Park /
Block: chip `not ready`, then `not ready for an agent: acceptance criteria — the pool skips it`.

**Deviation from the ticket, stated.** The ticket said "from the why payload's readiness field".
The inspector reads the identical field off the board row instead, which costs no extra request.
`pool-visibility.test.mjs` asserts the two are deep-equal, so they cannot diverge:

```js
assert.deepEqual(card(p, t.id).readiness, why(t.id, p).readiness);
```

It also moved out of the "blocked by" section and up to the workflow verbs. Readiness is not a
blocker — it stops no person from pressing Start — and below the fold it was not visible at all.

## AC4 — build, typecheck, committed bundle

`task-management/dashboard` had no `node_modules` in this worktree, which is why TM-179 deferred
this work. Resolved by the store's own worktree convention (`lib/worktree.mjs`: `node_modules`,
mode `symlink`) — linked to the main checkout's install.

```
npm run typecheck   → exit 0
npm run build       → exit 0   (tsc --noEmit && vite build && build-pwa.mjs)
npm run design:check→ exit 0   (no raw hex or rgba in src)
```

Control that the committed bundle is genuinely reproducible: **before** any source edit,
`npm run build` on `edd9a93` left `git status` clean — the committed `dist/` was byte-identical to
a fresh build. So the `dist/` diff in this commit is this change and nothing else.

## Unit tests

`node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs`

| tree | tests | pass | fail |
|---|---|---|---|
| `edd9a93` clean worktree (baseline) | 1506 | 1492 | **14** |
| this branch | 1510 | 1496 | **14** |

The failing set is **identical line for line** (diff of the two `not ok` lists is empty). Those 14
pre-date this work — claims, sessions, worktree, dispatch-handoff and hook tests — and are not
addressed here. The four new tests are the four added below, all passing.

### The new tests, and the control that proves they can fail

`tests/unit/pool-visibility.test.mjs` gained "the board payload carries each card's readiness".

The trap is specific: `boardPayload` strips `body` from every row, and `body` is a
`requireOnStart` field. Computing readiness from the stripped row returns `not ready: body` for
every task on the board — a clean, well-shaped answer that is wrong everywhere.

Control run, with `readinessVerdict(full, cfg)` replaced by `readinessVerdict(t, cfg)`:

```
not ok 1 - says ready for a complete task — the body it strips is still weighed
not ok 2 - names the gaps, and agrees with tm why field for field
# tests 10  # pass 8  # fail 2
```

Restored: `# tests 10  # pass 10  # fail 0`.

## Read, not verified

- The inspector panel does not respond to wheel scrolling in this browser session, so anything
  below the fold (acceptance, blocked-by, worktree, links) could not be screenshotted. **Control:**
  the same failure occurs on the unmodified dashboard running the committed pre-change bundle
  (port 49568), so it pre-dates this change and is not caused by it. Not fixed here; worth a task.
- Screenshots were captured from the agent-browser session's own live-frame endpoint, because the
  MCP screenshot tool returns images inline rather than to disk. Same session, same frames — the
  captured PNGs match the tool's own output.
