---
id: "TM-153"
kind: "task"
status: "in_progress"
created: "2026-09-10T02:10:53.601Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: test-pool.sh fails in every real checkout and passes only in a detached copy"
epic: "EP-018"
acceptance: [{"text":"The launch failure's stderr and argv reach the skip reason, or the log, so the cause is visible rather than an exit code with an empty string after it.","done":false},{"text":"The root cause of 'ao-topology launch exited 1' in a real checkout is established and named.","done":false},{"text":"test-pool.sh gives the same verdict in the canonical checkout, in a linked worktree and in a detached copy — or the difference is documented at the test as deliberate, with what each location exercises.","done":false}]
evidence: []
commits: ["ffa3355","113e2d7","578498b"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:30:45.245Z"
---

`tests/test-pool.sh` reports 17 passed / 2 failed in the canonical checkout AND in linked worktrees, and 19 passed / 0 failed in a tar or `git archive` extract of the same tree. Measured four ways: canonical checkout FAIL 2, .bytedesk/worktrees/TM-143-refusal (no TM-146 changes) FAIL 2, git archive of main PASS 19, tar of the TM-146 working tree PASS 19. So it is neither a revision difference nor TM-146's: it is the same shape as TM-152, a test whose result depends on where it runs.

The two failures are `once dispatches the ready-for-agent task` and `the dispatched task is in_progress`. The tick's own JSON says why:

    "skipped": [ { "id": "TM-001", "reason": "ao-topology launch exited 1: " } ]

An exit code with EMPTY stderr. In a detached copy the topology backend probe presumably finds nothing and the test takes a path that passes; in a real checkout it finds the real binary, calls it, and the call fails silently.

Two defects are tangled here and both matter. The dispatch path swallows a failing launch into a reason string with no stderr, so nobody can see what went wrong — that is the one to fix first, because it is what makes the second one hard. And the suite passes in exactly the condition where the backend is absent, which means a green run proves less than it appears to.