---
id: "TM-329"
kind: "task"
status: "open"
created: "2026-10-03T07:33:41.525Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-supervision-transport teardown races (ENOTEMPTY on presence dir) and then the suite hangs"
epic: "EP-026"
acceptance: [{"text":"Teardown waits for the supervisor to stop before removing the directory","done":false},{"text":"50 consecutive runs of the file show no failure","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T08:48:01.615Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:01.611Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Seen once in a full npm run test:unit on the merged EP-026 tree (test 'a supervisor keeps its pid across a real nats-server kill -9'); passed on re-run. The hookFailed teardown left the run hanging until killed.