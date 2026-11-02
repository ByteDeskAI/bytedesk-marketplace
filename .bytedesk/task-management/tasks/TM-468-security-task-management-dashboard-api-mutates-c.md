---
id: "TM-468"
kind: "task"
status: "done"
created: "2026-10-05T16:19:32.135Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY task-management dashboard API mutates claims and status with no authentication"
epic: "EP-028"
acceptance: [{"text":"Mutating dashboard API calls require a per-dashboard secret token (written 0600, sent by the UI) or are refused","done":true,"at":"2026-10-09T04:36:06.990Z"},{"text":"Claims made through the dashboard record the dashboard as actor, never borrow the lead's session for a worker request","done":true,"at":"2026-10-09T04:36:07.409Z"},{"text":"A test proves an unauthenticated POST is refused","done":true,"at":"2026-10-09T04:36:07.821Z"}]
evidence: [".bytedesk/task-management/evidence/TM-468-1791520568209.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/240"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:36:17.666Z"
priority: "high"
links: [{"type":"blocked by","id":"bytedeskai/bytedesk-remote-gateway#TM-560","board":"bytedeskai/bytedesk-remote-gateway"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-468-1791520568209.log":{"source":null,"sha256":"a098cd7249c54c74946e7b3e140fc520add7dee84084ddda542c4bc86db9ffe2","bytes":264,"at":"2026-10-09T04:36:08.210Z"}}
comments: [{"author":"main","ts":"2026-10-09T04:36:08.665Z","text":"review verdict: approved — independent reviewer rv-240 approved PR #240 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/240 (verdict delivered to the lead session)."},{"author":"@pool","ts":"2026-11-01T21:36:17.658Z","text":"bytedeskai/bytedesk-remote-gateway#TM-560 pr_opened: https://github.com/ByteDeskAI/bytedesk-remote-gateway/pull/358"}]
closed: "2026-10-09T04:36:09.147Z"
---

rv-222 while reviewing #224: dashboard-api.mjs calls claimTask(..., {session: sessionId()}) in the dashboard process for claim / in_progress transitions with no auth check, so any same-host process (a worker via curl 127.0.0.1:<port>) can act with the dashboard owner's session (often the lead's).