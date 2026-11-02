---
id: "TM-466"
kind: "task"
status: "done"
created: "2026-10-05T15:54:47.425Z"
board: "bytedeskai/bytedesk-marketplace"
title: "MCP mailbox tools use the SessionStart-minted identity"
epic: "EP-028"
acceptance: [{"text":"MCP send from a non-launcher Claude session succeeds as its minted id (test)","done":true,"at":"2026-10-09T00:26:10.583Z"}]
evidence: [".bytedesk/task-management/evidence/TM-466-1791505571071.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:26:11.448Z"
comments: [{"author":"main","ts":"2026-10-05T17:05:49.904Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ ec55c509 (independent review rv-225: merge after F1 console-show receipt leak; F2 handoff self-branch pane proof; F4 wait id oracle)"},{"author":"main","ts":"2026-10-05T17:56:52.556Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ 3350c3f4 (independent final delta review rv-225; follow-ups TM-473 TM-474)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-466-1791505571071.log":{"source":null,"sha256":"e77b4fef20061117e02f86616dee3a0550aac2cc1c24188ab91be19624b030d3","bytes":184,"at":"2026-10-09T00:26:11.072Z"}}
closed: "2026-10-09T00:26:11.442Z"
---

rv-193 on #193 (LOW-2): CLAUDE_ENV_FILE reaches Bash only, not the MCP server process, so orchestration_mailbox_send from a non-launcher session still fails with source_identity_required.