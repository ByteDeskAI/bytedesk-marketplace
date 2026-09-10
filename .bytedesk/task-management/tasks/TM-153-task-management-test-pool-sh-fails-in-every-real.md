---
id: "TM-153"
kind: "task"
status: "done"
created: "2026-09-10T02:10:53.601Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: test-pool.sh fails in every real checkout and passes only in a detached copy"
epic: "EP-018"
acceptance: [{"text":"The launch failure's stderr and argv reach the skip reason, or the log, so the cause is visible rather than an exit code with an empty string after it.","done":true,"at":"2026-09-10T03:40:13.622Z"},{"text":"The root cause of 'ao-topology launch exited 1' in a real checkout is established and named.","done":true,"at":"2026-09-10T03:40:13.770Z"},{"text":"test-pool.sh gives the same verdict in the canonical checkout, in a linked worktree and in a detached copy — or the difference is documented at the test as deliberate, with what each location exercises.","done":true,"at":"2026-09-10T03:40:13.912Z"}]
evidence: [".bytedesk/task-management/evidence/TM-153-HANDOFF.md"]
commits: ["554c975","a85a84a"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:40:14.060Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-153-HANDOFF.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-153-pool/.bytedesk/task-management/evidence/TM-153-HANDOFF.md","sha256":"db57eb3ddc33fdcbac73f56536da7947e1805c55124957be083f2c2d1664f386","bytes":3339,"at":"2026-09-10T03:36:30.302Z"}}
comments: [{"author":"main","ts":"2026-09-10T03:40:13.472Z","text":"MERGED at a85a84a. THE DECISIVE CHECK, run in the canonical checkout — the location that has been red all session:\n\n  before this merge   test-pool.sh   exit 1 — 17 passed, 2 failed\n  after this merge    test-pool.sh   exit 0 — 19 passed, 0 failed\n\nSame suite, same checkout, minutes apart, the only variable being the fix. That is the row that mattered, because the authors table listed 17/2 as the UNPATCHED control and the number to look for was 19/0 — if it had not moved, the fix would have been wrong rather than the location.\n\nFull gates on the merged tree, exit codes captured: unit 1370/1370; test-pool 19, hooks 65, hooks2 40, store 140, link 13, mcp 77, read 59, capability 22, concurrency 12, events 12, install 13, dashboard 210. Every one exit 0. THE TASK-MANAGEMENT SUITE IS ENTIRELY GREEN FOR THE FIRST TIME THIS SESSION.\n\nTWO DEFECTS, AND THE FIRST IS WHY NOBODY COULD SEE THE SECOND. ao-topology --json reports refusals as {ok:false, code, message} on STDOUT with exit 1 and stderr EMPTY, while all three dispatch backends built their reason from stderr alone. So the board recorded, verbatim, \"ao-topology launch exited 1:\" — an exit code, a colon, and nothing at all. The cause was being printed the whole time, on the stream nobody read.\n\nThe second: TM_DISPATCH_REGISTRY NEVER PARTICIPATED IN BACKEND SELECTION. resolveBackend walks the configured order, and a registry could only SUBSTITUTE a module for a name already in that list — so a registry naming a backend the order did not contain was never consulted. Its own doc comment says it exists \"so dispatch can be exercised end to end without spawning a worker\", and it could not do that. With a real ao-topology on the host, topology won and refused; in a detached copy it was unavailable and the walk fell through to something that succeeded. That is the whole location dependency.\n\nThis is the same shape as the reviewer that was never instructed to acknowledge a nonce: a mechanism documented as doing a job it could not physically do. Two independent instances in one epic is enough to call it a pattern worth looking for — a doc comment describing a capability is not evidence the capability is reachable.\n\nA NOTE ON MY OWN REPORTING. I told the author this branch was empty and carried none of its work. It was true when I looked and false minutes later — the author had described the fix before committing it. Reporting it was still right: after a merge landed earlier today with none of its code in it, \"I cannot see your work\" costs one message to be wrong about and catches a silent drop if it is right. The author has since changed its ordering to commit first and describe second."}]
closed: "2026-09-10T03:40:14.056Z"
---

`tests/test-pool.sh` reports 17 passed / 2 failed in the canonical checkout AND in linked worktrees, and 19 passed / 0 failed in a tar or `git archive` extract of the same tree. Measured four ways: canonical checkout FAIL 2, .bytedesk/worktrees/TM-143-refusal (no TM-146 changes) FAIL 2, git archive of main PASS 19, tar of the TM-146 working tree PASS 19. So it is neither a revision difference nor TM-146's: it is the same shape as TM-152, a test whose result depends on where it runs.

The two failures are `once dispatches the ready-for-agent task` and `the dispatched task is in_progress`. The tick's own JSON says why:

    "skipped": [ { "id": "TM-001", "reason": "ao-topology launch exited 1: " } ]

An exit code with EMPTY stderr. In a detached copy the topology backend probe presumably finds nothing and the test takes a path that passes; in a real checkout it finds the real binary, calls it, and the call fails silently.

Two defects are tangled here and both matter. The dispatch path swallows a failing launch into a reason string with no stderr, so nobody can see what went wrong — that is the one to fix first, because it is what makes the second one hard. And the suite passes in exactly the condition where the backend is absent, which means a green run proves less than it appears to.