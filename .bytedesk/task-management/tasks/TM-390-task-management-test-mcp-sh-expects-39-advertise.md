---
id: "TM-390"
kind: "task"
status: "done"
created: "2026-10-05T11:14:17.707Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: test-mcp.sh expects 39 advertised tools, server now advertises 45"
epic: "EP-028"
acceptance: [{"text":"test-mcp.sh asserts the real tool count (or the exact name set) and passes","done":true,"at":"2026-10-05T15:27:52.814Z"},{"text":"The assertion fails if a tool is added or removed without updating it","done":true,"at":"2026-10-05T15:27:53.311Z"}]
evidence: [".bytedesk/task-management/evidence/TM-390-1791214073837.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/217","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:58.345Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-390-1791214073837.log":{"source":null,"sha256":"33bbeba0e76f9d35b262ff81838a7dee5c091d9c56c78e92593a0256e00088f8","bytes":368,"at":"2026-10-05T15:27:53.838Z"}}
closed: "2026-10-05T15:27:54.267Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:57.906Z","text":"review-sweep: TM-390 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:39.603Z","text":"Board audit correction: PR #192 is NOT where this landed. The test-mcp exact tool-set assertion landed in PR #217 (merged to main via integration PR #216, 63458d7c)."},{"author":"main","ts":"2026-10-05T15:37:58.340Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/217 (independent post-merge review rv-216)"}]
---

Pre-existing on fix/ao-local-nats-autostart 7be05521 (verified 2026-10-05 in a detached worktree): bash task-management/tests/test-mcp.sh exits 1, 76 passed 1 failed, 'tools/list advertises 39 tools - got 45'. The contract count is stale; tools were added without updating the test.