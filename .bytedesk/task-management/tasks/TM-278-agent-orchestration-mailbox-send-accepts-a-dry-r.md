---
id: "TM-278"
kind: "task"
status: "done"
created: "2026-10-02T01:11:18.500Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox send accepts a dry-run flag and ignores it, queueing a real message"
epic: "EP-028"
acceptance: [{"text":"A dry run on mailbox send prints destination repo, resolved lead and delivery or hold reason and writes no envelope, or the flag is rejected with a named error","done":true,"at":"2026-10-05T13:15:31.430Z"},{"text":"A test fails if a dry run leaves any record in the outbox or standing mailbox","done":true,"at":"2026-10-05T13:15:31.760Z"},{"text":"Every other send verb is grepped and either shares the behavior or shows the flag rejected","done":true,"at":"2026-10-05T13:15:32.109Z"}]
evidence: [".bytedesk/task-management/evidence/TM-278-1791206132463.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:11.347Z"
comments: [{"author":"main","ts":"2026-10-05T12:31:29.851Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-send is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:24.055Z","text":"review-sweep: TM-278 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:41.805Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:53:11.344Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195 (independent post-merge review rv-195; fixes TM-462 TM-464)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-278-1791206132463.log":{"source":null,"sha256":"2fbe8424edb47da7237aa7a997b442cd396c554f45dc99577a4a7879b947c62a","bytes":233,"at":"2026-10-05T13:15:32.464Z"}}
closed: "2026-10-05T13:15:32.798Z"
---

ao-topology mailbox send with a dry-run flag queued a real envelope (id x, body x, d60f0608 to fd2b831f), held as unknown_recipient because no consumer was given, then retried on backoff. cli.mjs handles dry-run only for the permissions verbs; mailbox send has no handling, so the flag is silently ignored. Fix: either resolve routing and print the decision (destination repo, lead, delivery or hold reason) with no envelope written, or reject the flag. Check every sibling send verb for the same silent acceptance. Reported by the gateway lead via the gateway-repo session.