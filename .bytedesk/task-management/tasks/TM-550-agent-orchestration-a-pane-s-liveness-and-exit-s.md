---
id: "TM-550"
kind: "task"
status: "open"
created: "2026-11-01T21:40:21.080Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: 'a pane's liveness and exit status come from one answer' is flaky (2 of 5 isolated runs fail: exit status null, expected 42)"
epic: "EP-019"
acceptance: [{"text":"The test passes 20 of 20 isolated runs and 5 of 5 full-suite runs (record the commit and dirty state per verification-that-can-fail rule 8)","done":false},{"text":"If the fix is in production code rather than the test, a dead pane with no exit status yet is reported as status-unknown, never as null-success","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "72f1fc09-2253-4281-a926-682424a11029"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:40:27.245Z"
priority: "high"
---

Found by lead fd2b831f re-running TM-528's required checks, 2026-11-01. Detached worktree at 88fea25b (PR #265), 0 dirty paths, env -i argv. Full agent-orchestration unit: 1351 pass / 1 fail, 'not ok 614 - a pane's liveness and exit status come from one answer' (tests/unit/topology-launch.test.mjs): 'the status arrives with the deadness, not from a second query — null !== 42'. Isolated with --test-name-pattern, 5 runs: pass, pass, FAIL, pass, FAIL. Neither the test nor topology/lib/launch.mjs differs between 8189a6bd and 88fea25b, so this is pre-existing, not TM-528. Likely the pane is observed dead before tmux records #{pane_dead_status}. A flaky required check blocks every governed AO merge at random.