---
id: "TM-328"
kind: "task"
status: "open"
created: "2026-10-03T07:33:40.986Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: launched spec workers can never acknowledge their staged prompt (prompt-state has no session or binding)"
epic: "EP-026"
acceptance: [{"text":"A launched worker's prompt ack succeeds and the state becomes current","done":false},{"text":"Test covers launch-staged state, not only library-agent staging","done":false}]
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
updated: "2026-10-03T08:48:01.293Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:01.288Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

launch.mjs:1040 writes prompt-state.json without desired_session/desired_binding/repo_id, but acknowledgePrompt requires them, so a spec-launched claude worker's 'ao-topology prompt ack' fails with TOPOLOGY_PROMPT_ACK_INVALID. Pre-existing in f8af1cd8; the worker still works but its prompt stays awaiting-ack.