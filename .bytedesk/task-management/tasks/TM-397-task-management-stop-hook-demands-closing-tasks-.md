---
id: "TM-397"
kind: "task"
status: "done"
created: "2026-10-05T12:31:47.481Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: stop hook demands closing tasks owned by live worker subagents of the same session"
epic: "EP-028"
acceptance: [{"text":"Stop hook does not block on tasks claimed by this session whose worker subagent is live","done":true,"at":"2026-10-05T14:15:29.780Z"},{"text":"Tasks with no live owner still block as today","done":true,"at":"2026-10-05T14:15:30.199Z"},{"text":"Test covers both","done":true,"at":"2026-10-05T14:15:30.574Z"}]
evidence: [".bytedesk/task-management/evidence/TM-397-1791209730996.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/203","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:34:59.993Z"
comments: [{"author":"main","ts":"2026-10-05T13:17:15.114Z","text":"Queued for EP-028 worker w-guard (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:34.158Z","text":"review-sweep: TM-397 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:34:59.988Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/203 (independent post-merge review rv-203; fixes TM-436 TM-437 TM-438)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-397-1791209730996.log":{"source":null,"sha256":"f22888e4257b7fb4a6cd6b3743b24f3c97f18e832f896646a4fa70db38a033eb","bytes":324,"at":"2026-10-05T14:15:30.997Z"}}
closed: "2026-10-05T14:15:31.447Z"
---

EP-028 lead session 2026-10-05: four Agent-tool workers in worktrees held 10 claimed tasks; the Stop hook (tm-hook.sh stop) repeatedly demanded done/block/park. Parking releases claims mid-work and lets the pool re-dispatch. The hook should recognise tasks whose claim belongs to a live subagent or carry a recent 'actively in progress' marker, and say so instead of blocking.