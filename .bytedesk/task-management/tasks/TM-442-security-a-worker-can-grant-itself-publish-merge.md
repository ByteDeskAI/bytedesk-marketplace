---
id: "TM-442"
kind: "task"
status: "done"
created: "2026-10-05T15:35:34.956Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY a worker can grant itself publish/merge autonomy and choose the release argv"
epic: "EP-028"
acceptance: [{"text":"management.autonomy, release, cutover and required_checks are honoured only from an operator-controlled source (signed, or the server-side default branch as TM-263 does), never a layer a worker can write","done":true,"at":"2026-10-09T00:58:48.822Z"},{"text":"ao-topology config set refuses in a worker session","done":true,"at":"2026-10-09T00:58:49.215Z"},{"text":"release/cutover argv[0] must be a tracked repo-relative script; interpreters and absolute paths are refused (tests)","done":true,"at":"2026-10-09T00:58:49.633Z"}]
evidence: [".bytedesk/task-management/evidence/TM-442-1791507530051.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:58:50.464Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T15:50:19.391Z","text":"rv-gov on #213 adds: a reviewed PR setting management.autonomy/cutover.argv in the committed repo config lands under merge; integrate should refuse a change to management.* keys, and argvProblem should be an allowlist."},{"author":"main","ts":"2026-10-05T17:20:33.373Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:44.844Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:55.289Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-442-1791507530051.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:58:50.053Z"}}
closed: "2026-10-09T00:58:50.459Z"
---

w-secreview on #216. config.mjs autonomyOf reads the unprotected global layer; ao-topology config set --scope global has no worker refusal and is auto-approved; release.mjs argvProblem checks only basename(argv[0]) (node -e, python3, busybox, npx, absolute paths pass). The lead's next manage land runs it with the lead's environment.