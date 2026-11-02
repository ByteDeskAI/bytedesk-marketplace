---
id: "TM-457"
kind: "task"
status: "done"
created: "2026-10-05T15:50:14.078Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY cut-release waits for the TeamCity build of its own revision"
epic: "EP-028"
acceptance: [{"text":"waitForBuild matches the release revision (and branch) and records the matched build","done":true,"at":"2026-10-09T00:58:56.326Z"},{"text":"A green build of another revision does not satisfy it (test)","done":true,"at":"2026-10-09T00:58:56.685Z"}]
evidence: [".bytedesk/task-management/evidence/TM-457-1791507537095.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:21:47.831Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:20:34.792Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:46.400Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:56.936Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-457-1791507537095.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:58:57.096Z"}}
closed: "2026-10-09T00:58:57.476Z"
---

rv-gov on #213: teamcity.mjs:21,34 waitForBuild accepts the first finished build of the build type with id > since, on any branch/revision, so a green develop/PR build passes the release gate while the release build is red.