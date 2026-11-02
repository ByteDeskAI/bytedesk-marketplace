---
id: "TM-486"
kind: "task"
status: "done"
created: "2026-10-08T23:25:50.761Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-483 AC2: caller identity on MCP mailbox receive/dispose; clear human_required on goals"
epic: "EP-028"
acceptance: [{"text":"Whatever part of TM-483 AC2 #225 does not cover is implemented with tests","done":true,"at":"2026-10-09T04:49:38.962Z"},{"text":"human_required on goals is cleared as TM-483 specifies (test)","done":true,"at":"2026-10-09T04:49:39.415Z"}]
evidence: [".bytedesk/task-management/evidence/TM-486-1791521379894.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T04:49:40.744Z"
comments: [{"author":"main","ts":"2026-10-09T02:13:31.403Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 @ de307b4e (independent review + delta rv-236)"},{"author":"main","ts":"2026-10-09T04:49:40.293Z","text":"review verdict: approved — independent subagent reviewer approved PR #236 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 (verdict delivered to the lead session)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-486-1791521379894.log":{"source":null,"sha256":"e5cade638f7159f17a30b616c0ea83bee02133c4af73b1c7e3da9c82b122d1b9","bytes":98,"at":"2026-10-09T04:49:39.895Z"}}
closed: "2026-10-09T04:49:40.735Z"
---

Split from TM-483: PR #229 met AC1 (supervisor survives failed publish retries) but AC2 was out of the worker's scope: caller identity on MCP mailbox receive and dispose, and clearing human_required on goals. Check whether #225 already covers the MCP identity part.