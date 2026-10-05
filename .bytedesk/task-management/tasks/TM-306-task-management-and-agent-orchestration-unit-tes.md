---
id: "TM-306"
kind: "task"
status: "open"
created: "2026-10-03T01:13:53.024Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management and agent-orchestration unit tests fail when run inside a dispatched worker session's environment"
epic: "EP-021"
acceptance: [{"text":"The 9 task-management failures are named and each is traced to an inherited variable or shown to be something else","done":false},{"text":"Both suites pass unchanged when run with the dispatched-worker environment set, shown by a run inside such a session","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "81e61d16-ae0f-495c-a2a4-7148fc8fa898"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T01:13:57.267Z"
comments: [{"author":"main","ts":"2026-10-03T01:13:57.261Z","text":"Overlaps TM-205 (task-management unit tests red only inside a dispatched worker). Treat TM-306 as the agent-orchestration half plus a check that TM-205 and TM-293 share a cause; merge or close one when TM-205 is picked up."}]
---

TM-304 round 2 reports that under the env a dispatched worker inherits (TM_DISPATCH_WORKER, TM_SESSION_ID, CLAUDECODE and others) ao test:unit fails 4 tests (TM-293) and task-management unit fails 9, also on the base branch. With those variables cleared: ao 1014 pass, task-management 1589/1589. So worker runs report failures that are the environment, and the suite does not isolate itself. Make each suite clear or pin the ambient variables it depends on, and name which 9 tests. Check whether TM-293's four are the same cause before treating them as separate.