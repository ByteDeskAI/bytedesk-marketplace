---
id: "TM-441"
kind: "task"
status: "done"
created: "2026-10-05T15:35:34.270Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY merge-in acceptance uses whitespace-blind patch-id, so a merge can carry unreviewed code"
epic: "EP-028"
acceptance: [{"text":"A merge-in is accepted only when its tree equals git merge-tree --write-tree <approved revision> <integration branch>","done":true,"at":"2026-10-09T00:58:46.233Z"},{"text":"Both plugins use the same rule; a whitespace-only behaviour change is refused (test)","done":true,"at":"2026-10-09T00:58:46.697Z"}]
evidence: [".bytedesk/task-management/evidence/TM-441-1791507527118.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1","0110e0b7"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:24:53.941Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T15:50:19.016Z","text":"Also found by rv-gov on #215 (reproduced with re-indented Python). Both copies (management.mjs, governance-check.mjs)."},{"author":"main","ts":"2026-10-05T17:20:32.939Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:44.461Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:54.937Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-441-1791507527118.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:58:47.119Z"}}
closed: "2026-10-09T00:58:47.502Z"
---

w-secreview on #216. management.mjs mergeInOf (~51) and governance-check.mjs mirror (~119) compare git patch-id --stable, which ignores whitespace: 'rm -rf /tmp/build' vs 'rm -rf / tmp/build' match; Python indentation moves match. The PR path lands that head (~886-892) and governedCompletion closes it.