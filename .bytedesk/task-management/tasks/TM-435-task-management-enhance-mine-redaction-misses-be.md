---
id: "TM-435"
kind: "task"
status: "done"
created: "2026-10-05T15:33:05.446Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management enhance-mine: redaction misses bearer tokens, URL credentials, -p passwords and NAME=value secrets"
epic: "EP-028"
acceptance: [{"text":"A table test of at least 8 secret shapes, each fully redacted","done":true,"at":"2026-10-08T23:58:36.231Z"},{"text":"The fixture run puts none of them on the board","done":true,"at":"2026-10-08T23:58:36.685Z"}]
evidence: [".bytedesk/task-management/evidence/TM-435-1791503917113.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/223"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:58:37.569Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T16:02:17.156Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/223 @ a901980b (independent re-review rv-222); final round adds the remaining secret shapes"},{"author":"main","ts":"2026-10-05T16:13:38.584Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/223 @ 7a7a200a (independent delta review rv-222 approved e4479df5; final AIza rule verified by lead: test-enhance-mine.sh 135/135, key redacted)"},{"author":"review-sweep","ts":"2026-10-06T16:15:51.600Z","text":"review-sweep: PR #223 \"TM-435: enhance-mine redacts bearer tokens, URL credentials, -p passwords and NAME=value secrets\" has had no activity for 24h — needs an independent review or a decision."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-435-1791503917113.log":{"source":null,"sha256":"4c5473525e45e09e108f51a13ac3aaf55360143678d304e8012d4f587bfd6862","bytes":225,"at":"2026-10-08T23:58:37.114Z"}}
closed: "2026-10-08T23:58:37.563Z"
---

Post-merge review of #189 (rv-190). Leaks confirmed: 'Authorization: Bearer <tok>' (only 'Bearer' redacted), https://user:pass@host, postgres://app:pass@db, mysql -p<pw>, short ALLCAPS=value. Samples go into git-tracked proposal bodies.