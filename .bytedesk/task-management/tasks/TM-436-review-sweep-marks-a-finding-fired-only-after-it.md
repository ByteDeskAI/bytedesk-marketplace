---
id: "TM-436"
kind: "task"
status: "open"
created: "2026-10-05T15:34:54.582Z"
board: "bytedeskai/bytedesk-marketplace"
title: "review-sweep marks a finding fired only after it is delivered"
epic: "EP-028"
acceptance: [{"text":"With no lead registered, the next sweep still reports the finding as fresh","done":false},{"text":"A failed delivery is retried on the next tick","done":false},{"text":"A delivered finding never fires twice","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:34:58.039Z"
priority: "high"
---

Post-merge review of #203 (rv-203). tm review-sweep --apply writes the fired marker before agent-orchestration delivers; with no lead (action skipped) or a thrown send (status failed) the finding never fires again.