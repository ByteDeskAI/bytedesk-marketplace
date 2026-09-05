---
id: "TM-108"
kind: "task"
status: "open"
created: "2026-09-05T13:17:06.397Z"
board: "bytedeskai/bytedesk-marketplace"
title: "singleton port tests are flaky under parallel load"
epic: "EP-013"
acceptance: [{"text":"The singleton port tests pass 20 consecutive full-suite runs","done":false},{"text":"They assert stability rather than a specific port number","done":false}]
evidence: []
commits: ["0c936a6"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "chore/tm099-golden-routing"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T13:17:35.351Z"
type: "bug"
priority: "low"
---

tests/unit/singleton.test.mjs asserts exact port numbers ('the port survives a restart', 'keeps a drifted assignment when the dashboard.* files are swept') and fails intermittently when the whole unit suite runs in parallel - seen as 50325 !== 50324. Roughly one run in six.

Pre-existing and unrelated to EP-013: measured at the same rate on a tree with the planner work stashed out (1 failure in 6 baseline runs, same test). Recorded so the next person to see a red suite does not go looking in the planner for it.

The assertion is inherently racy: it pins a specific number from a probe-for-free-port helper while other tests in the same run are also probing. The fix is to assert the invariant the test actually cares about - that the assignment is stable across a restart, and that a sweep does not move it - rather than that it equals a particular integer.