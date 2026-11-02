---
id: "TM-440"
kind: "task"
status: "open"
created: "2026-10-05T15:34:57.538Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration supervisor calls tm claim renew --live each tick"
epic: "EP-028"
acceptance: [{"text":"The supervisor tick runs tm claim renew --live through the CLI when tm is present","done":false},{"text":"A test proves a live worker's claim is renewed with the pool stopped","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:34:57.548Z"
---

Post-merge review of #199 (rv-203): nothing in agent-orchestration calls tm claim renew --live, so with the pool stopped no claim is renewed, contrary to TM-362's intent.