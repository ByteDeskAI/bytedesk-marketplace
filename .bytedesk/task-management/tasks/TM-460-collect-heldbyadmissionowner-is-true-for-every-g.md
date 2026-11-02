---
id: "TM-460"
kind: "task"
status: "done"
created: "2026-10-05T15:50:16.313Z"
board: "bytedeskai/bytedesk-marketplace"
title: "collect heldByAdmissionOwner is true for every governed dispatch, stranding crashed workers"
epic: "EP-028"
acceptance: [{"text":"Held only when the owner re-claimed after dispatched.at or the owner is proven alive","done":true,"at":"2026-10-09T00:13:45.196Z"},{"text":"A crashed worker with an absent owner is parked or retried (test)","done":true,"at":"2026-10-09T00:13:45.563Z"}]
evidence: [".bytedesk/task-management/evidence/TM-460-1791504825916.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:21:46.881Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T16:19:34.466Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ f15b8fd4 (independent re-review rv-222); final round drops the TM-460 since-shortcut"},{"author":"main","ts":"2026-10-05T16:24:45.378Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ 7dd1f3f8 (independent delta review rv-222: both findings closed)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-460-1791504825916.log":{"source":null,"sha256":"e1ce15667ece98f982c63dbb363bc39289e3b59435a129a7f25ca685b607cd9a","bytes":162,"at":"2026-10-09T00:13:45.917Z"}}
closed: "2026-10-09T00:13:46.338Z"
---

rv-gov on #215: because AC13 claims under the admission owner, heldByAdmissionOwner is true for every governed dispatch; a crashed worker after its lead is gone is never parked or retried until the claim TTL.