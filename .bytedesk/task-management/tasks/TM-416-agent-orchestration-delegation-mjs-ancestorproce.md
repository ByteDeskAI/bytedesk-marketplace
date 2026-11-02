---
id: "TM-416"
kind: "task"
status: "done"
created: "2026-10-05T14:17:59.383Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: delegation.mjs ancestorProcesses should share heartbeat.mjs ancestorPids"
epic: "EP-028"
acceptance: [{"text":"delegation.mjs uses the shared ancestorPids","done":true,"at":"2026-10-05T15:27:58.555Z"},{"text":"Existing delegation tests pass","done":true,"at":"2026-10-05T15:27:59.055Z"}]
evidence: [".bytedesk/task-management/evidence/TM-416-1791214079588.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/219"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:50:23.903Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-416-1791214079588.log":{"source":null,"sha256":"765a7b8fb91439fb0b84982a2a23b0411c7662eed0844dcf9c4a1806ef86513a","bytes":368,"at":"2026-10-05T15:27:59.590Z"}}
closed: "2026-10-05T15:28:00.122Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:59.350Z","text":"review-sweep: TM-416 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:50:23.898Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/219 (independent post-merge review rv-gov; note: worker evidence handled by TM-430)"}]
---

Found by the TM-411 worker: topology/lib/delegation.mjs:65 has a second process-ancestry walk. Rule 3: one implementation for one predicate.