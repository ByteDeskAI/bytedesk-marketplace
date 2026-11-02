---
id: "TM-464"
kind: "task"
status: "done"
created: "2026-10-05T15:53:09.593Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration review LOWs: CLI inbox/dispose identity, MCP argv injection, ls-remote option injection, non-hermetic tests"
epic: "EP-028"
acceptance: [{"text":"Each of the four fixed with a test","done":true,"at":"2026-10-09T00:26:05.245Z"},{"text":"Both test files pass and exit with AO_SESSION_* set in the parent env","done":true,"at":"2026-10-09T00:26:05.614Z"}]
evidence: [".bytedesk/task-management/evidence/TM-464-1791505565964.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:26:06.323Z"
comments: [{"author":"main","ts":"2026-10-05T15:54:48.232Z","text":"rv-193 adds: (a) the TM-356 MCP test also inherits AO_SESSION_AGENT_ID/AO_SESSION_CONSUMER (exported by SessionStart since TM-353), so it is red in every agent session; scrub them in tests/unit/register-file-transport.mjs; (b) CLI mailbox reply, outbox and receipts also take --agent freely (cli.mjs:680,694,695), not only inbox/dispose."},{"author":"main","ts":"2026-10-05T17:05:49.007Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ ec55c509 (independent review rv-225: merge after F1 console-show receipt leak; F2 handoff self-branch pane proof; F4 wait id oracle)"},{"author":"main","ts":"2026-10-05T17:56:51.771Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ 3350c3f4 (independent final delta review rv-225; follow-ups TM-473 TM-474)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-464-1791505565964.log":{"source":null,"sha256":"e77b4fef20061117e02f86616dee3a0550aac2cc1c24188ab91be19624b030d3","bytes":184,"at":"2026-10-09T00:26:05.965Z"}}
closed: "2026-10-09T00:26:06.317Z"
---

rv-195 LOWs: (1) CLI mailbox inbox/dispose --agent <other> stay unbound while MCP is bound (rule 3); (2) topology-api runMailSend/runArgs pass subject/task as separate argv, so '--from-project=/x' parses as a flag; (3) diagnostics.mjs:78 git ls-remote <repository> without '--'; (4) topology-mailbox-send.test.mjs fails under a host AO_SESSION_AGENT_ID and hangs on an open handle; mcp-parity test 2 needs a file transport or AO_NATS_AUTOSTART=0.