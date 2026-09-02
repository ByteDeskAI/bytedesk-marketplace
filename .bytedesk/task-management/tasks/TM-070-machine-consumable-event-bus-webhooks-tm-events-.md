---
id: "TM-070"
kind: "task"
status: "done"
created: "2026-09-02T06:57:43.553Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Machine-consumable event bus: webhooks + tm events --follow"
epic: "EP-009"
acceptance: [{"text":"webhook fan-out beside ntfy in the logEvent chain: config webhooks[] of local URLs, fire-and-forget, per-kind filter reusing the ntfy CATALOG","done":true,"at":"2026-09-02T08:14:44.804Z"},{"text":"webhook failure never affects store writes (logEvent still never throws)","done":true,"at":"2026-09-02T08:14:44.923Z"},{"text":"tm events --follow --json tails events.jsonl across rotation as the stdio alternative","done":true,"at":"2026-09-02T08:14:45.030Z"},{"text":"contract test with a stub HTTP server proves every event kind is POSTed and failures are swallowed","done":true,"at":"2026-09-02T08:14:45.134Z"}]
evidence: [".bytedesk/task-management/evidence/TM-070-tm070.log"]
commits: []
blockedBy: []
blocks: ["TM-073"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T08:14:45.761Z"
touches: ["task-management/bin/tm","task-management/lib/notify-hook.mjs","task-management/lib/webhooks.mjs","task-management/tests/unit/webhooks.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T08:14:45.757Z"
---

