---
id: "TM-473"
kind: "task"
status: "done"
created: "2026-10-05T17:56:49.049Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY console show operator gate passes any process with TMUX_PANE unset"
epic: "EP-028"
acceptance: [{"text":"When TMUX_PANE is unset, the caller's /proc ancestry is checked against every census-bound pane_pid and refused on a match (test)","done":true,"at":"2026-10-09T04:49:31.224Z"},{"text":"console show is kept off agent tool surfaces (permissions deny) or requires a human attestation; documented","done":true,"at":"2026-10-09T04:49:31.628Z"},{"text":"The code comment states the real boundary (TMUX_PANE unset), not 'outside every bound pane'","done":true,"at":"2026-10-09T04:49:32.082Z"}]
evidence: [".bytedesk/task-management/evidence/TM-473-1791521372556.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236","83c07c96","fccb17b1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T08:19:24.988Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T02:13:30.530Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 @ de307b4e (independent review + delta rv-236)"},{"author":"main","ts":"2026-10-09T04:49:33.021Z","text":"review verdict: approved — independent subagent reviewer approved PR #236 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 (verdict delivered to the lead session)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-473-1791521372556.log":{"source":null,"sha256":"e5cade638f7159f17a30b616c0ea83bee02133c4af73b1c7e3da9c82b122d1b9","bytes":98,"at":"2026-10-09T04:49:32.557Z"}}
closed: "2026-10-09T04:49:33.476Z"
---

rv-225 final on #225: assertOperatorReader treats 'no identity and bindingAgentId null' as a bare operator; bindingAgentId is null whenever TMUX_PANE is absent (delegation.mjs:266), so 'env -u TM_DISPATCH_WORKER -u AO_AGENT_ID -u AO_SESSION_AGENT_ID -u TMUX_PANE ao-topology console show ...' from a worker reads every agent's mail. setsid -f also escapes ancestry. Part of TM-427B env-trust.