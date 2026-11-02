---
id: "TM-463"
kind: "task"
status: "done"
created: "2026-10-05T15:53:08.804Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY session handoff can be pointed at any agent's pane by any session (CLI and MCP)"
epic: "EP-028"
acceptance: [{"text":"Only the repository's registered lead or the agent itself may hand off; check lives in the CLI verb so MCP shares it","done":true,"at":"2026-10-09T00:26:02.676Z"},{"text":"A non-lead caller is refused via both MCP and CLI (test)","done":true,"at":"2026-10-09T00:26:03.102Z"}]
evidence: [".bytedesk/task-management/evidence/TM-463-1791505563535.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:26:03.893Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:05:48.659Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ ec55c509 (independent review rv-225: merge after F1 console-show receipt leak; F2 handoff self-branch pane proof; F4 wait id oracle)"},{"author":"main","ts":"2026-10-05T17:56:51.417Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ 3350c3f4 (independent final delta review rv-225; follow-ups TM-473 TM-474)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-463-1791505563535.log":{"source":null,"sha256":"e77b4fef20061117e02f86616dee3a0550aac2cc1c24188ab91be19624b030d3","bytes":184,"at":"2026-10-09T00:26:03.537Z"}}
closed: "2026-10-09T00:26:03.886Z"
---

rv-195 on #201: orchestration_session_handoff (src/mcp.mjs:285) and the CLI verb (cli.mjs:1534 passHandoff) take any agent and type a pointer to a caller-written file into that agent's live pane: prompt injection into a lead or reviewer.