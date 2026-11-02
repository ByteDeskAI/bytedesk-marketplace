---
id: "TM-444"
kind: "task"
status: "done"
created: "2026-10-05T15:35:36.518Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY required checks run in the worker's worktree, where ignored files can fake a pass"
epic: "EP-028"
acceptance: [{"text":"Required checks run in a fresh detached worktree of record.finish.revision (or after git clean -xdf)","done":true,"at":"2026-10-09T00:58:54.152Z"},{"text":"A test plants an ignored fake runner and the check fails","done":true,"at":"2026-10-09T00:58:54.495Z"}]
evidence: [".bytedesk/task-management/evidence/TM-444-1791507534850.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:58:55.195Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:20:34.109Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:45.631Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:56.181Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-444-1791507534850.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:58:54.851Z"}}
closed: "2026-10-09T00:58:55.190Z"
---

w-secreview on #216. integrateTask (~746) runs checks with cwd: doc.worktree; status --porcelain hides ignored paths, so a planted node_modules/.bin/<runner> exiting 0 passes a check that never ran.