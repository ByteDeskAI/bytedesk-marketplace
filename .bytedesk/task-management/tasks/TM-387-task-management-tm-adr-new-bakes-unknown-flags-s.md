---
id: "TM-387"
kind: "task"
status: "open"
created: "2026-10-05T11:00:02.791Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm adr new bakes unknown flags such as --body into the ADR title"
epic: "EP-028"
acceptance: [{"text":"tm adr new refuses (non-zero, named error) any unknown flag instead of appending it to the title","done":false},{"text":"One shared stray-flag guard is used by every <noun> new verb; a test covers adr new","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T11:00:02.799Z"
---

Found 2026-10-05 creating ADR-0041: tm adr new "<title>" --body - stored the title '<title> --body -' and left Context/Decision/Consequences empty, reporting success. epic new and task new have the stray-flag guard (verification-that-can-fail.md rule 3); adr new does not. Share one guard across every 'new' verb.