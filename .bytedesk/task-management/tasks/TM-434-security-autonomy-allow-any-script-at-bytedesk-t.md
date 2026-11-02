---
id: "TM-434"
kind: "task"
status: "done"
created: "2026-10-05T15:33:04.119Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY autonomy-allow: any script at .../.bytedesk/task-management/bin/tm runs unprompted"
epic: "EP-028"
acceptance: [{"text":"A tm at an arbitrary path or a worktree-relative tm falls through","done":true,"at":"2026-10-08T23:46:10.108Z"},{"text":"Only bare tm on PATH or the realpath of the plugin's own launcher is approved","done":true,"at":"2026-10-08T23:46:10.575Z"},{"text":"tm config is not auto-approved; tests cover all three","done":true,"at":"2026-10-08T23:46:11.010Z"}]
evidence: [".bytedesk/task-management/evidence/TM-434-1791503171910.log",".bytedesk/task-management/evidence/TM-434-1791503193402.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:46:33.409Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T16:02:16.786Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222 @ c9778e4d (independent re-review rv-222); final round adds updatedInput absolute-path pinning, tmux path pinning, prompt ack ownAgent"},{"author":"main","ts":"2026-10-05T16:12:15.609Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222 @ 45965f69 (independent delta review rv-222: updatedInput realpath pinning, tmux pinning, prompt ack ownAgent)"},{"author":"main","ts":"2026-10-08T23:46:32.968Z","text":"Correction: the first merge attempt failed (short SHA) and the evidence line recorded an empty commit. The task was closed seconds early; PR #222 is now actually merged to main at b43e5cb2."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-434-1791503171910.log":{"source":null,"sha256":"b84306e161c8e4ea62a23b4c13c4b4c08c19f4da2a0766ac412bbdcdcc8cda64","bytes":228,"at":"2026-10-08T23:46:11.912Z"},".bytedesk/task-management/evidence/TM-434-1791503193402.log":{"source":null,"sha256":"29765a57f4f14ac99e1b97819e141d1952f4cfd076cf0d78ed355745cf9ae1d2","bytes":68,"at":"2026-10-08T23:46:33.403Z"}}
closed: "2026-10-08T23:46:12.559Z"
---

Post-merge review of #190 (rv-190). autonomy-allow.mjs:24 TM regex accepts any directory prefix (/tmp/x/.bytedesk/task-management/bin/tm, ./.bytedesk/...); a worker can write or edit that script in its worktree. Also: tm config (operator policy) is auto-approved.