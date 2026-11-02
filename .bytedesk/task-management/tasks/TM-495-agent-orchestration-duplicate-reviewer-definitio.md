---
id: "TM-495"
kind: "task"
status: "open"
created: "2026-10-09T01:48:02.951Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: duplicate reviewer definitions crash-loop the repository supervisor (TOPOLOGY_PRESENCE_MULTIPLE_STANDING), and no verb removes an agent"
epic: "EP-028"
acceptance: [{"text":"An ambiguous standing role is reported (alert to the lead, status reason) while the supervisor keeps running every other duty; test","done":false},{"text":"reviewer ensure is idempotent under concurrent calls: one reviewer definition per repo; test with parallel ensures","done":false},{"text":"A supported lead-only 'ao-topology agent retire <id>' archives a non-live agent definition (refuses a live one); test","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:48:24.674Z"
priority: "high"
links: [{"type":"duplicated by","id":"TM-494"}]
comments: [{"author":"main","ts":"2026-10-09T01:48:24.663Z","text":"Merged from TM-494 (duplicate): also include 'ao-topology agent retire <id>' (refused for a live or registered agent). agent-browser lead identified the extras: Cleo Duvall b58195de, Hana Thorne cf74f195, Tovi Duvall fbccd0d0; Juno a076d527 is registered."}]
---

Seen 2026-10-09 by the marketplace lead: services status shows supervise-5cef2378f8a90e38 (bytedesk-agent-browser) Restarting with 181 restarts; its log repeats 'error TOPOLOGY_PRESENCE_MULTIPLE_STANDING: Multiple repository reviewer definitions; refusing ambiguous presence.' bytedesk-agent-browser/.bytedesk/agent-orchestration/agents has FOUR role=reviewer definitions created within ~3 minutes on 2026-10-05 (b58195de 09:06:52, cf74f195 09:08:32, fbccd0d0 09:08:36, a076d527 09:09:16); only a076d527 (Juno) is live. Three defects: (1) one ambiguous presence makes the whole repo supervisor exit and crash-loop (lead recovery, mail resume, review sweep all stop for that repo) instead of degrading that one role and alerting the lead; (2) reviewer ensure (or agent new) minted four reviewer definitions in three minutes — a mint race or missing idempotency (cf TM-364 MEDIUM-4 adoption); (3) 'ao-topology agent' has new/list/show/restart/set-instructions but no supported retire/remove, so a lead cannot fix (2) without hand-editing agent dirs.