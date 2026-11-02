---
id: "TM-433"
kind: "task"
status: "done"
created: "2026-10-05T15:33:02.943Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY autonomy-allow: replace the ao-topology denylist with an allowlist"
epic: "EP-028"
acceptance: [{"text":"install-hooks, git-hook install, config set, review submit, send, launch and manage close/transfer/assign fall through","done":true,"at":"2026-10-08T23:46:07.063Z"},{"text":"Only an explicit allowlist of read/report verbs is auto-approved, documented beside each verb's ADR-0001 class","done":true,"at":"2026-10-08T23:46:07.516Z"}]
evidence: [".bytedesk/task-management/evidence/TM-433-1791503168286.log",".bytedesk/task-management/evidence/TM-433-1791503192513.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:46:32.519Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T16:02:16.457Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222 @ c9778e4d (independent re-review rv-222); final round adds updatedInput absolute-path pinning, tmux path pinning, prompt ack ownAgent"},{"author":"main","ts":"2026-10-05T16:12:15.195Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/222 @ 45965f69 (independent delta review rv-222: updatedInput realpath pinning, tmux pinning, prompt ack ownAgent)"},{"author":"main","ts":"2026-10-08T23:46:32.108Z","text":"Correction: the first merge attempt failed (short SHA) and the evidence line recorded an empty commit. The task was closed seconds early; PR #222 is now actually merged to main at b43e5cb2."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-433-1791503168286.log":{"source":null,"sha256":"b84306e161c8e4ea62a23b4c13c4b4c08c19f4da2a0766ac412bbdcdcc8cda64","bytes":228,"at":"2026-10-08T23:46:08.287Z"},".bytedesk/task-management/evidence/TM-433-1791503192513.log":{"source":null,"sha256":"29765a57f4f14ac99e1b97819e141d1952f4cfd076cf0d78ed355745cf9ae1d2","bytes":68,"at":"2026-10-08T23:46:32.514Z"}}
closed: "2026-10-08T23:46:08.694Z"
---

Post-merge review of #190 (rv-190). The denylist misses write/exec/review verbs, all ALLOW today: startup install-hooks, git-hook install, config set, review submit (self-approval, compounds TM-427), send (types into another pane), launch, manage close|transfer|assign.