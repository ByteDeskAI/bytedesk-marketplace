---
id: "TM-175"
kind: "task"
status: "done"
created: "2026-09-11T19:42:59.872Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: make the dispatch pool safe to leave running"
epic: "EP-021"
acceptance: [{"text":"busy is counted from in_progress tasks with a dispatched record after collect; backendCaps read task.dispatched.backend; a test with a short agentTtlMinutes proves poolWip holds after TTL","done":true,"at":"2026-09-11T20:17:00.224Z"},{"text":"SIGTERM during a slow tick ends the loop after that tick and removes pool.pid","done":true,"at":"2026-09-11T20:17:00.460Z"},{"text":"touches of in_progress tasks are treated as occupied when choosing the collision-free set","done":true,"at":"2026-09-11T20:17:00.647Z"},{"text":"a dispatch that fails after provisioning removes the worktree it created, and a re-dispatch of that task succeeds","done":true,"at":"2026-09-11T20:17:00.774Z"},{"text":"pool.pid is created with the exclusive wx flag; two concurrent runPool calls yield exactly one running pool","done":true,"at":"2026-09-11T20:17:00.908Z"},{"text":"after dispatch.maxFailures consecutive failures (default 3) or one usage/quota-limit failure the pool pauses, records pausedReason, logs pool_paused; tm pool resume clears it","done":true,"at":"2026-09-11T20:17:01.053Z"},{"text":"collect logs worker_overrun once for a worker past dispatch.maxRuntimeMinutes (default 120) without parking it","done":true,"at":"2026-09-11T20:17:01.180Z"},{"text":"each fix has a regression test shown failing on the pre-fix commit; node --test task-management/tests/unit and tests/test-pool.sh exit 0","done":true,"at":"2026-09-11T20:17:01.329Z"}]
evidence: [".bytedesk/task-management/evidence/TM-175-VERIFY.md"]
commits: ["fc25845"]
blockedBy: []
blocks: ["TM-178"]
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T20:17:04.219Z"
comments: [{"author":"main","ts":"2026-09-11T19:47:50.740Z","text":"delegated 2026-09-11 by lead session c3738e82 to Agent-tool worker 'w-pool' in an isolated worktree; work is live, not abandoned. Lead reviews and merges; do not park or restart unless that worker is confirmed gone. Stop gate cannot see Agent-tool delegation (CAP-0003)."},{"author":"main","ts":"2026-09-11T20:17:01.642Z","text":"merged to main as fc25845 (worker commits 99763a6, efc0e42); lead re-ran unit glob 1393/1393 and test-pool.sh 26/26 at efc0e42, exit 0, clean worktree. Brake resets on done (lead decision). B3 readiness gate deferred to TM-178."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-175-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-175-VERIFY.md","sha256":"0ab2eadb304b2e813249d643972f656de32964b1848ba3bbaa8ad62fcff4c055","bytes":4254,"at":"2026-09-11T20:17:01.471Z"}}
closed: "2026-09-11T20:17:01.844Z"
---

Defects found reading lib/dispatch/pool.mjs and index.mjs. B4: capacity counts registry agents whose 30-minute heartbeat is never renewed for tmux/topology workers (pid null), so poolWip stops holding after agentTtlMinutes. B5: tm pool stop during a tick is lost (stop only wakes a sleep) and the SIGTERM listener removes default exit. B6: batches() ignores in_progress tasks, so running work's touches never block a collision. B7: a failed dispatch leaves its worktree; the next git worktree add fails forever. B8: livePool check then writePoolPid is not atomic. Brakes: no failure brake, no quota pause, no runtime visibility.