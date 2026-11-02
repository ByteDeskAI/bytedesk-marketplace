---
id: "TM-506"
kind: "task"
status: "open"
created: "2026-10-09T02:42:08.951Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management lock.test.mjs assumes pid 999999 is dead; fails deterministically on a host where it is live"
epic: "EP-028"
acceptance: [{"text":"lock.test.mjs passes on a host where pid 999999 is alive","done":false},{"text":"the dead-holder pid used by the tests is proven dead when the test runs","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/242"]
blockedBy: []
blocks: []
actor: "@main"
session: "fd2b831f"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T03:12:41.491Z"
---

Two tests in task-management/tests/unit/lock.test.mjs ('is not blocked by a lock some older version committed to the repo' and 'treats a lock whose holder is gone as dead') write a lock with pid 999999 and expect staleLock() to call it dead. staleLock uses process.kill(pid, 0), and on this host (pid_max 4194304) node -e 'process.kill(999999,0)' succeeds, so both tests fail 3/3. Seen 2026-10-08 by the TM-478 worker at ab2006bc..4f366ec (task-management untouched by that branch). Fix: pick a pid proven dead at test time (spawn a child, wait for exit, reuse its pid) or inject the liveness check.