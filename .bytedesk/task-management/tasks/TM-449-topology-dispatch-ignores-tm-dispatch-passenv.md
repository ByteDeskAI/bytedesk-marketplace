---
id: "TM-449"
kind: "task"
status: "done"
created: "2026-10-05T15:37:01.860Z"
board: "bytedeskai/bytedesk-marketplace"
title: "topology dispatch ignores tm dispatch.passEnv"
epic: "EP-028"
acceptance: [{"text":"tm dispatch.passEnv names reach ao-topology launch, or docs and the dispatch event say they do not","done":true,"at":"2026-10-09T00:13:42.507Z"},{"text":"A test covers it","done":true,"at":"2026-10-09T00:13:43.000Z"}]
evidence: [".bytedesk/task-management/evidence/TM-449-1791504823448.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:13:43.856Z"
comments: [{"author":"main","ts":"2026-10-05T16:19:34.053Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ f15b8fd4 (independent re-review rv-222); final round drops the TM-460 since-shortcut"},{"author":"main","ts":"2026-10-05T16:24:45.028Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ 7dd1f3f8 (independent delta review rv-222: both findings closed)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-449-1791504823448.log":{"source":null,"sha256":"e1ce15667ece98f982c63dbb363bc39289e3b59435a129a7f25ca685b607cd9a","bytes":162,"at":"2026-10-09T00:13:43.449Z"}}
closed: "2026-10-09T00:13:43.850Z"
---

rv-197 on #200: AO reads only workers.passEnv; the dispatch skill and CHANGELOG say topology passes tm dispatch.passEnv too.