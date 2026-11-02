---
id: "TM-458"
kind: "task"
status: "done"
created: "2026-10-05T15:50:14.800Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY autonomy publish never grants production cutover"
epic: "EP-028"
acceptance: [{"text":"publish grants cut-release only; cutover always requires operator --authorized","done":true,"at":"2026-10-09T00:58:58.689Z"},{"text":"Test 21 is inverted: publish without --authorized refuses cutover","done":true,"at":"2026-10-09T00:58:59.136Z"}]
evidence: [".bytedesk/task-management/evidence/TM-458-1791507539523.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:58:59.976Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:20:35.127Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:46.744Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:57.272Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-458-1791507539523.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:58:59.524Z"}}
closed: "2026-10-09T00:58:59.971Z"
---

rv-gov on #213: release.mjs:60 externalAuthority lets management.autonomy=publish run cutover (production deploy) with no human; test 21 asserts it. Conflicts with the standing rule that deploying to a live production host asks first, and ADR-0001 External class.