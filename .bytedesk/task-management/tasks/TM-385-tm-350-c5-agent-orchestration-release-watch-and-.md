---
id: "TM-385"
kind: "task"
status: "blocked"
created: "2026-10-05T10:59:43.704Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-350 C5 agent-orchestration: release watch and consumer auto-resume"
epic: "EP-028"
acceptance: [{"text":"Exactly one notice per subscription on upstream close with a SHA; consumer task unblocked","done":false},{"text":"A closure without a SHA is reported, not resolved","done":false}]
evidence: []
commits: []
blockedBy: ["TM-382","TM-383","TM-384"]
blocks: ["TM-386"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-05T11:00:14.276Z"
parent: "TM-350"
---

ADR-0041. Owns lib/upstream.mjs (after C3) and one call at supervision.mjs:245. Each tick reads subscribed upstream task files; on done + landing SHA runs consumer tm upstream-resolved, then standing mail to the consumer lead with ticket, SHA and the C6 activation report.