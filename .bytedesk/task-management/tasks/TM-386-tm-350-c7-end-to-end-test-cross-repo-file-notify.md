---
id: "TM-386"
kind: "task"
status: "blocked"
created: "2026-10-05T10:59:45.104Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-350 C7 end-to-end test: cross-repo file, notify, close, unblock, wake"
epic: "EP-028"
acceptance: [{"text":"File -> notice delivered -> upstream close with SHA -> consumer unblocked -> consumer lead woken, with no human step","done":false},{"text":"The test fails if any one stage is removed (mutation check recorded)","done":false}]
evidence: []
commits: []
blockedBy: ["TM-382","TM-383","TM-384","TM-385","TM-388"]
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-05T11:00:13.414Z"
parent: "TM-350"
---

ADR-0041. Owns a new agent-orchestration/tests file. Two temp repos with stores, fake tmux per tmux-test-isolation.md (TMUX='', per-test TMUX_TMPDIR, -L socket).