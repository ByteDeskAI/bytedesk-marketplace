---
id: "TM-319"
kind: "task"
status: "open"
created: "2026-10-03T04:06:54.904Z"
board: "bytedeskai/bytedesk-marketplace"
title: "remote-gateway: merge nats/orch-grants and cut over safely; note leaf option conflicts with a paired Store"
epic: "EP-026"
acceptance: [{"text":"Reviewed and merged by a human; safe cutover run via the repo's own flow","done":false},{"text":"Existing agents' creds still work after restart","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179"]
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T08:47:48.837Z"
---

Branch nats/orch-grants commit 6b7af5d7 (TM-313). Legacy creds regroup on the next gateway start; leaf option cannot be enabled on a host that pairs a Store.