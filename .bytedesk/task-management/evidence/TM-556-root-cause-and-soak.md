# TM-556 evidence: root cause, regression test, soak

## Root cause (measured on a live supervisor, 2026-11-10)

`ao-topology supervise --consumer .../bytedesk-remote-gateway` (pid 3027290, up 4d 2h, RSS 2.6 GB).
Inspector opened with SIGUSR1, closed afterwards.

- `process.memoryUsage()`: heapUsed 2,383,516,848 of rss 2,691,936,256 -> the growth is JS heap.
- Sampling heap profiler, 240 s: 1.62 MB of 2.15 MB retained allocations at `Readable.push`
  (child-process stdout chunks) -> about 24 MB/h, matching proceval's ~25 MiB/h.
- `Runtime.queryObjects(Array.prototype)`: one array of 138,536 strings, 2 unique values
  (`bytedesk-emote-gateway-claude-2Aq7q2ejyX_f`, `bytedesk-emote-gateway-grok-cutover-recover`).
- Owner: `watchServer` in `topology/lib/startup.mjs`. The daemon loop calls `startupCheck` for every
  unregistered provider pane on every 5 s tick and pushes the session name onto `labelled`, which a
  daemon never returns. Each name is a V8 sliced string of that tick's `tmux list-panes` stdout, so
  each push pins the whole listing. Idle repositories have no unregistered panes and stay ~120 MiB.
- Same re-check appends a journal line per tick: `~/.local/state/bytedesk/agent-orchestration/startup/`
  was 7.5 GB (largest file 1.04 GB).

## Fix

Each pane incarnation (the six identity fields) is checked once per watcher lifetime; the set is
pruned to panes listed this tick, so it is bounded by live panes, and a respawn is checked afresh.

## Regression test

`tests/unit/topology-startup.test.mjs`: "a daemon watcher checks each pane incarnation once, not once
per tick" (50 ticks, one respawn; asserts 2 labels and 2 journal lines).
- With the old startup.mjs: `not ok 1` (fails).
- With the fix: `ok`.

## Soak against the real tmux server (read-only listing, isolated state dir)

`/tmp/tm556/soak-real.mjs`, watcher daemon loop at 100 ms ticks, RSS/heap after GC each minute.

### Before (base d6e25a21), 5 min
```
{"min":1,"rssMiB":97.6,"heapMiB":10.4}
{"min":2,"rssMiB":104.1,"heapMiB":14.7}
{"min":3,"rssMiB":110.8,"heapMiB":18.95}
{"min":4,"rssMiB":115.6,"heapMiB":23.15}
{"min":5,"rssMiB":121.8,"heapMiB":27.43}
{"min":5,"rssMiB":121.8,"heapMiB":26.93}
{"lib":"startup.mjs","acquired":true,"ticks":646,"labelled":27735,"rssGrowthPct":24.8,"heapGrowthPct":158.9,"state":"/tmp/tm556-soak-real-iNQH6H"}
```
### After (this branch), 9 min — 4,847 ticks = about 6.7 h of production 5 s ticks
```
{"min":1,"rssMiB":93.3,"heapMiB":5.47}
{"min":2,"rssMiB":95.4,"heapMiB":5.73}
{"min":3,"rssMiB":96.7,"heapMiB":5.91}
{"min":4,"rssMiB":97.4,"heapMiB":5.96}
{"min":5,"rssMiB":97.6,"heapMiB":5.98}
{"min":6,"rssMiB":98,"heapMiB":6.17}
{"min":7,"rssMiB":98.6,"heapMiB":6.18}
{"min":8,"rssMiB":98.9,"heapMiB":6.22}
{"min":9,"rssMiB":98.1,"heapMiB":6.15}
{"min":9,"rssMiB":98.1,"heapMiB":5.89}
{"lib":"startup.mjs","acquired":true,"ticks":4847,"labelled":43,"rssGrowthPct":5.1,"heapGrowthPct":7.7,"state":"/tmp/tm556-soak-real-VQVctZ"}
```
### Synthetic soak, 10,000 ticks (sliced-string listing), after the fix
```
{"lib":"startup.mjs","ticks":10000,"labelled":2,"seconds":27.108,"heapMiB":[[1000,5.96],[2000,6.08],[3000,6.12],[4000,6.27],[5000,6.27],[6000,6.31],[7000,6.3],[8000,6.32],[9000,6.3],[10000,6.33]],"growthPct":6.2}
```

## Required checks at the commit
agent-orchestration unit and task-management unit exit 1 with failure sets identical to the base
commit d6e25a21 run in a clean detached worktree (10 and 41 pre-existing failures; diff empty).
All other checks exit 0.

## Not done here
- proceval confirmation on the live host needs the fix on main and supervisors restarted.
- The 7.5 GB of existing startup journals were not deleted (operator data).
