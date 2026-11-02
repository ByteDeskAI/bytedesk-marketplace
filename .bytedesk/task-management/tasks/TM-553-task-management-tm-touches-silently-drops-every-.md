---
id: "TM-553"
kind: "task"
status: "in_progress"
created: "2026-11-01T22:50:52.246Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm touches silently drops every .bytedesk/ path, so a task that edits committed AO policy (.bytedesk/agent-orchestration/config.json) can never be admitted"
epic: "EP-019"
acceptance: [{"text":"tm touches <id> .bytedesk/agent-orchestration/config.json records the path (test)","done":false},{"text":"Store and worktree paths (.bytedesk/task-management/..., .bytedesk/worktrees/...) are still ignored by the edit hook (test)","done":false},{"text":"When tm touches ignores a path it prints the path and the reason, never 'nothing new' (test)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "fd2b831f"
branch: "tm/TM-553-task-management-tm-touches-silently-drops-every-"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-553-task-management-tm-touches-silently-drops-every-"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T22:50:58.391Z"
priority: "high"
touches: ["task-management/CHANGELOG.md","task-management/bin/tm","task-management/lib/touches.mjs","task-management/tests/unit/touches.test.mjs"]
comments: [{"author":"main","ts":"2026-11-01T22:50:57.891Z","text":"{\"event\":\"start\",\"at\":\"2026-11-01T22:50:57.772Z\",\"owner\":\"fd2b831f\",\"worktree\":\"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-553-task-management-tm-touches-silently-drops-every-\",\"branch\":\"tm/TM-553-task-management-tm-touches-silently-drops-every-\",\"base_revision\":\"90a9bd4812b3f4349ba24f5b136b72407df14050\",\"base_source\":\"server-tip\",\"intent\":\"Implement TM-553: narrow the touches IGNORED list to store/worktree paths and report ignored paths explicitly, with tests.\",\"boundaries\":[\"task-management/lib/touches.mjs\",\"task-management/bin/tm\",\"task-management/tests/unit/touches.test.mjs\",\"task-management/CHANGELOG.md\"],\"dependencies\":[],\"checks\":[\"agent-orchestration: npm ci\",\"agent-orchestration: unit\",\"agent-orchestration: build:check\",\"task-management: unit\",\"agent-orchestration: plugin validate\",\"task-management: plugin validate\",\"plugin-rsync: tests\"],\"files\":[\"task-management/CHANGELOG.md\",\"task-management/bin/tm\",\"task-management/lib/touches.mjs\",\"task-management/tests/unit/touches.test.mjs\"]}"}]
governance: {"version":1,"runtime":"topology","workflowRunId":"tm-TM-553","leadId":"fd2b831f","recordPath":"/home/ryan/.local/state/bytedesk/agent-orchestration/management/8890762dbb279261/TM-553.json","state":"working"}
---

Reported by design-system lead d04c2baa, 2026-11-01. 'tm touches TM-150 .bytedesk/agent-orchestration/config.json' prints 'touches: 0 path(s) (nothing new)' and records nothing; 'ao-topology manage admit' then refuses TOPOLOGY_MANAGEMENT_SCOPE, and 'manage close' requires that committed policy file (TOPOLOGY_MANAGEMENT_TARGET), so there is no governed route for it. Workaround: isolated worker subagent + reviewed PR.

Cause (lead fd2b831f): task-management/lib/touches.mjs:35 IGNORED = [/(^|\/)\.bytedesk\//, ...] drops ALL of .bytedesk/, meant to keep the store and worktrees out of collision data, but it also drops committed repository policy (.bytedesk/agent-orchestration/config.json, .bytedesk/design-patterns/*). The CLI then reports the drop as 'nothing new', so the refusal is invisible (verification rule 5).

Fix: ignore only machine/store paths (.bytedesk/task-management/, .bytedesk/worktrees/, .bytedesk/knowledge/, .bytedesk/agent-orchestration/agents/), and make 'tm touches' name any path it ignored and why instead of 'nothing new'.