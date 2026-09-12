---
id: "TM-179"
kind: "task"
status: "done"
created: "2026-09-11T19:43:00.791Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: show pool state and task readiness in the CLI and dashboard"
epic: "EP-021"
acceptance: [{"text":"tm why <id> prints the readiness verdict and each missing item","done":true,"at":"2026-09-12T02:08:03.381Z"},{"text":"GET /api/pool returns the same data as tm pool status --json, with a unit test","done":true,"at":"2026-09-12T02:08:03.560Z"},{"text":"tm pool status (and --json) reports enabled, running, pid, paused reason and failure count, workers against poolWip, the ready count, pollSeconds, idleExitMinutes and the log path — per-task skip reasons stay in tm why and the pool log, because a read-only status must not run a tick","done":true,"at":"2026-09-12T02:08:03.730Z"},{"text":"pool_paused and worker_overrun are in the ntfy catalog and reach events.jsonl; an automatic triage label change is visible in that task's update event rather than a second event, which TM-176 deliberately forbids","done":true,"at":"2026-09-12T02:08:03.872Z"}]
evidence: [".bytedesk/task-management/evidence/TM-179-VERIFY.md"]
commits: []
blockedBy: ["TM-178"]
blocks: []
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-12T02:08:04.362Z"
labels: ["ready-for-agent"]
triagedBy: "auto"
touches: [".claude/worktrees/tm-179/task-management/CHANGELOG.md",".claude/worktrees/tm-179/task-management/README.md",".claude/worktrees/tm-179/task-management/bin/tm",".claude/worktrees/tm-179/task-management/docs/dashboard-api.md",".claude/worktrees/tm-179/task-management/lib/dashboard-api.mjs",".claude/worktrees/tm-179/task-management/lib/dispatch/pool.mjs",".claude/worktrees/tm-179/task-management/lib/graph.mjs",".claude/worktrees/tm-179/task-management/tests/unit/pool-visibility.test.mjs"]
comments: [{"author":"main","ts":"2026-09-12T02:07:08.957Z","text":"scope split: the dashboard pool card and readiness on task cards move to a new task — dashboard/ builds from the private npm registry (@bytedesk/design-tokens) and has no node_modules in this tree, so the React surface cannot be built or verified here. CLI and HTTP halves shipped."},{"author":"main","ts":"2026-09-12T02:08:04.197Z","text":"merged to main as 9a616ef (commit 40ca731); unit 1487/1487 and contract all green at that commit, clean tree; merged tree identical for task-management/. Dashboard half split to TM-188."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-179-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-179-VERIFY.md","sha256":"f18a0c4f51e8f089e1eeb322d89104e44ff73c087e85ab54df207c45088576a1","bytes":3630,"at":"2026-09-12T02:08:04.015Z"}}
closed: "2026-09-12T02:08:04.357Z"
---

Nothing shows why a task is not ready or what the pool is doing. Add a readiness section to tm why; extend tm pool status with enabled, pausedReason, queue head and skip reasons from a dry-run tick; add GET /api/pool to lib/dashboard-api.mjs; add a dashboard pool card (state, workers, queue, enable toggle through the existing POST /api/settings) and readiness reasons on task cards. Log task_auto_triaged, pool_paused and worker_overrun to events.jsonl so ntfy carries them.