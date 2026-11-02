---
id: "TM-432"
kind: "task"
status: "done"
created: "2026-10-05T15:33:01.829Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY autonomy-allow: gated ao-topology verbs bypassed by a leading flag"
epic: "EP-028"
acceptance: [{"text":"The four commands above fall through to the normal permission flow","done":true,"at":"2026-10-08T23:46:03.637Z"},{"text":"A test runs every gated verb with flags before and after the subcommand","done":true,"at":"2026-10-08T23:46:03.983Z"},{"text":"The decision uses the same argument parsing rule as the ao-topology CLI","done":true,"at":"2026-10-08T23:46:04.447Z"}]
evidence: [".bytedesk/task-management/evidence/TM-432-1791503165214.log",".bytedesk/task-management/evidence/TM-432-1791503191710.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:21:46.262Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T16:02:16.118Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222 @ c9778e4d (independent re-review rv-222); final round adds updatedInput absolute-path pinning, tmux path pinning, prompt ack ownAgent"},{"author":"main","ts":"2026-10-05T16:12:14.740Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222 @ 45965f69 (independent delta review rv-222: updatedInput realpath pinning, tmux pinning, prompt ack ownAgent)"},{"author":"review-sweep","ts":"2026-10-06T16:15:51.883Z","text":"review-sweep: PR #222 \"TM-432 TM-433 TM-434: SECURITY autonomy-allow allowlist (0.16.1)\" has had no activity for 24h — needs an independent review or a decision."},{"author":"main","ts":"2026-10-08T23:46:31.215Z","text":"Correction: the first merge attempt failed (short SHA) and the evidence line recorded an empty commit. The task was closed seconds early; PR #222 is now actually merged to main at b43e5cb2."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-432-1791503165214.log":{"source":null,"sha256":"b84306e161c8e4ea62a23b4c13c4b4c08c19f4da2a0766ac412bbdcdcc8cda64","bytes":228,"at":"2026-10-08T23:46:05.216Z"},".bytedesk/task-management/evidence/TM-432-1791503191710.log":{"source":null,"sha256":"29765a57f4f14ac99e1b97819e141d1952f4cfd076cf0d78ed355745cf9ae1d2","bytes":68,"at":"2026-10-08T23:46:31.711Z"}}
closed: "2026-10-08T23:46:05.654Z"
---

Post-merge review of #190 (rv-190). scripts/autonomy-allow.mjs:46-49 gates on positional words[1]/[2], but ao-topology parseArgs strips --k v pairs first. ALLOW today: 'ao-topology manage --task TM-1 land --authorized', 'manage --task TM-1 integrate', 'delegate --id x grant', '--summary=1 permissions install'. A worker in auto mode lands/merges/grants with no prompt.