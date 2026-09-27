---
id: "TM-237"
kind: "task"
status: "open"
created: "2026-09-24T23:09:15.479Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: workflow-index rejected[].message carries raw error text, including pane captures, into the gateway UI"
epic: "EP-019"
acceptance: [{"text":"Every rejected[] entry carries a stable code and a short fixed human sentence chosen by that code; no message contains text taken from stdout, a pane capture, a file's contents or a parser error.","done":false},{"text":"Raw diagnostic text, when kept, goes only to a separate bounded detail field (length-capped, control and escape sequences stripped) or a local debug log, and the index schema documents that field as untrusted.","done":false},{"text":"TOPOLOGY_TMUX_FAILED no longer falls back to stdout for its message.","done":false},{"text":"A test forces each rejection path (tmux failure with pane text on stdout, invalid JSON, preservation failure) and asserts the message is the fixed sentence and holds no input text or escape bytes.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-24T23:09:15.929Z"
priority: "high"
---

Linked to gateway TM-456 (reported by gateway lead d60f0608, 2026-09-24): the gateway's Orchestration tab Diagnostics showed raw Claude Code terminal chrome. The gateway now sanitizes PRODUCER_RECORD_REJECTED on its side (gateway PR 231); this task fixes the producer. Verified by reading at HEAD: topology/lib/discovery.mjs:227, 237, 266, 279 and 295 push error.message verbatim into workflow-index/v1 rejected[].message. topology/lib/tmux.mjs:31 builds TOPOLOGY_TMUX_FAILED from result.stderr, falling back to result.stdout when stderr is empty, so a failing capture-pane can put pane text into the message. util.mjs:141 (readJson) embeds the V8 JSON.parse error, which quotes a snippet of the file.