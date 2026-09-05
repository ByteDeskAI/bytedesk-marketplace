---
id: "TM-108"
kind: "task"
status: "done"
created: "2026-09-05T13:17:06.397Z"
board: "bytedeskai/bytedesk-marketplace"
title: "singleton port tests are flaky under parallel load"
epic: "EP-015"
acceptance: [{"text":"The singleton port tests pass 20 consecutive full-suite runs","done":true,"at":"2026-09-05T15:31:50.060Z"},{"text":"They assert stability rather than a specific port number","done":true,"at":"2026-09-05T15:31:50.176Z"}]
evidence: [".bytedesk/task-management/evidence/TM-108-TM-108-soak-20-runs.txt"]
commits: ["0c936a6","8f01165","fbb2d25","f6bf160"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T15:33:51.307Z"
type: "bug"
priority: "low"
comments: [{"author":"main","ts":"2026-09-05T15:31:50.297Z","text":"20 consecutive full-suite runs on the settled tree, all green — evidence at evidence/TM-108-soak-20-runs.txt. Each run is ./run-tests.sh in full: 1340 node:test units plus the 13 bash contract suites.\n\nThe assertions state the invariant rather than an integer. Both tests pinned a specific number out of a probe-for-free-port helper while the rest of the suite was probing in parallel, so roughly one run in six another test's board held portFor(base)+7, ensurePort correctly moved off it, and the assertion failed — the fallback working as designed, reported as a red suite. What the tests are actually about is that an assignment does not move: not when the dashboard.* files are swept, and not when an old-name assignment is adopted. Where the number still matters they read it from ensurePort's own 'previous', which is what it reports when it had to reassign, so the drifted assignment is still proven to be where it started whether it was kept or moved off.\n\nAn earlier soak in this session showed six red runs, and none of them were these tests — they were my own edits landing mid-soak, plus one genuine unrelated flake I then fixed: listSessions sorted 'newest first' by readdirSync order when two timestamps tied, which is a real user-visible nondeterminism rather than a test problem. This soak ran against a tree nobody was editing."}]
closed: "2026-09-05T15:31:50.537Z"
---

tests/unit/singleton.test.mjs asserts exact port numbers ('the port survives a restart', 'keeps a drifted assignment when the dashboard.* files are swept') and fails intermittently when the whole unit suite runs in parallel - seen as 50325 !== 50324. Roughly one run in six.

Pre-existing and unrelated to EP-013: measured at the same rate on a tree with the planner work stashed out (1 failure in 6 baseline runs, same test). Recorded so the next person to see a red suite does not go looking in the planner for it.

The assertion is inherently racy: it pins a specific number from a probe-for-free-port helper while other tests in the same run are also probing. The fix is to assert the invariant the test actually cares about - that the assignment is stable across a restart, and that a sweep does not move it - rather than that it equals a particular integer.