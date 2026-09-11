---
id: "TM-163"
kind: "task"
status: "done"
created: "2026-09-10T20:59:08.067Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: bind prompt application to the exact process incarnation"
epic: "EP-019"
acceptance: [{"text":"Queued and restart-required prompts cannot be acknowledged or marked current.","done":true,"at":"2026-09-10T21:12:01.736Z"},{"text":"A controlled restart promotes the pending prompt, binds a fresh nonce to the new six-tuple, and requires acknowledgement from that incarnation.","done":true,"at":"2026-09-10T21:12:02.048Z"},{"text":"A replacement incarnation invalidates earlier prompt-current proof, even when the revision is unchanged.","done":true,"at":"2026-09-10T21:12:02.267Z"},{"text":"Healthy reattachment does not silently replace a live prompt, while retained dead sessions restart with the pending prompt.","done":true,"at":"2026-09-10T21:12:02.499Z"}]
evidence: [".bytedesk/task-management/evidence/TM-163-topology-prompt-lifecycle.test.mjs",".bytedesk/task-management/evidence/TM-163-topology-launch.test.mjs"]
commits: ["119006c"]
blockedBy: []
blocks: ["TM-164"]
actor: "main"
session: "01a088d4-54f3-7781-a6df-8860bd57ba9a"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T18:22:08.248Z"
labels: ["ready-for-agent"]
type: "bug"
touches: ["agent-orchestration/tests/unit/topology-cli-prompt.test.mjs","agent-orchestration/tests/unit/topology-launch.test.mjs","agent-orchestration/tests/unit/topology-prompt-lifecycle.test.mjs","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/incarnation.mjs","agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/prompt-lifecycle.mjs"]
evidenceSources: {".bytedesk/task-management/evidence/TM-163-topology-prompt-lifecycle.test.mjs":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/tests/unit/topology-prompt-lifecycle.test.mjs","sha256":"9fb0e754a6ab061591583db6e40cbae5fa77e1fd0eef42e43cd6edc1cd8f1e60","bytes":7049,"at":"2026-09-10T21:12:01.280Z"},".bytedesk/task-management/evidence/TM-163-topology-launch.test.mjs":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/tests/unit/topology-launch.test.mjs","sha256":"1475bc88d700078b435392bd34c52bf55e9c8b98eef3b5916e66404ba6ad5156","bytes":54198,"at":"2026-09-10T21:12:01.493Z"}}
closed: "2026-09-10T21:12:02.691Z"
---

Implement an incarnation-bound prompt lifecycle and controlled managed-session restart. Pending prompts become ackable only after the new tmux binding exists; acknowledgements prove agent, repository, session, pane, revision, nonce, and exact live binding.