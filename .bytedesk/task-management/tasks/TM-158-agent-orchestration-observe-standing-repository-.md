---
id: "TM-158"
kind: "task"
status: "done"
created: "2026-09-10T02:37:33.685Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: observe standing repository topology"
epic: "EP-019"
acceptance: [{"text":"observer target discovery includes the verified live standing repository conductor","done":true,"at":"2026-09-10T02:44:37.061Z"},{"text":"observer can attach, inspect census state, and close without mutating repository sessions","done":true,"at":"2026-09-10T02:44:37.149Z"},{"text":"installed caches and personal observer agent are refreshed from the verified commit","done":true,"at":"2026-09-10T02:44:37.226Z"}]
evidence: [".bytedesk/task-management/evidence/TM-158-1789008276966.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "01a088d4-54f3-7781-a6df-8860bd57ba9a"
branch: "feature/orchestration-observer-ready"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/.bytedesk-marketplace-worktrees/orchestration-observer-ready"
updated: "2026-09-10T02:44:37.316Z"
labels: ["ready-for-agent"]
touches: ["agent-orchestration"]
evidenceSources: {".bytedesk/task-management/evidence/TM-158-1789008276966.log":{"source":null,"sha256":"068039edd5ec251702ccb0832229694fe081c2787cddcbf9b12d40432d82b5b1","bytes":421,"at":"2026-09-10T02:44:36.967Z"}}
closed: "2026-09-10T02:44:37.311Z"
---

Complete observer integration on current mainline and support selection of the live repository conductor plus its enrolled or observed terminals when no workflow run directory exists.