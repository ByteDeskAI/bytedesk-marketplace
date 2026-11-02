---
id: "TM-411"
kind: "task"
status: "done"
created: "2026-10-05T13:45:33.714Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: prompt ack works from a child shell of the agent's pane"
epic: "EP-028"
acceptance: [{"text":"An ack from a subshell of the registered pane process is accepted","done":true,"at":"2026-10-05T15:27:45.489Z"},{"text":"An ack from an unrelated process is still refused","done":true,"at":"2026-10-05T15:27:45.965Z"},{"text":"Tests cover both","done":true,"at":"2026-10-05T15:27:46.359Z"}]
evidence: [".bytedesk/task-management/evidence/TM-411-1791214066802.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:57.524Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-411-1791214066802.log":{"source":null,"sha256":"b29223f89bc98211ccc28e9e64439b81b9e24d9b5276725791800f68ca279d84","bytes":368,"at":"2026-10-05T15:27:46.803Z"}}
closed: "2026-10-05T15:27:47.205Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:58.977Z","text":"review-sweep: TM-411 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:57.519Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207 (independent post-merge review rv-216)"}]
---

Split from TM-309 (run note). prompt ack is refused from a child shell (also seen in agent-browser lead 2026-10-05: TOPOLOGY_PROMPT_ACK_INVALID).