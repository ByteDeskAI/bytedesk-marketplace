---
id: "TM-271"
kind: "task"
status: "done"
created: "2026-10-01T14:08:47.620Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: send and mailbox send can address a repository's lead by repo path or slug"
epic: "EP-028"
acceptance: [{"text":"The to-repo option accepts a repo path or slug and delivers to that repo's registered lead","done":true,"at":"2026-10-05T13:15:33.437Z"},{"text":"An unknown repo or a repo with no lead refuses with the reason, exit non-zero, nothing delivered","done":true,"at":"2026-10-05T13:15:33.774Z"},{"text":"send and mailbox send share one resolver, with a test through each CLI entry","done":true,"at":"2026-10-05T13:15:34.175Z"}]
evidence: [".bytedesk/task-management/evidence/TM-271-1791206134524.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:11.781Z"
comments: [{"author":"main","ts":"2026-10-05T12:31:30.209Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-send is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:23.630Z","text":"review-sweep: TM-271 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:42.302Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:53:11.776Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195 (independent post-merge review rv-195; fixes TM-462 TM-464)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-271-1791206134524.log":{"source":null,"sha256":"2fbe8424edb47da7237aa7a997b442cd396c554f45dc99577a4a7879b947c62a","bytes":233,"at":"2026-10-05T13:15:34.525Z"}}
closed: "2026-10-05T13:15:34.911Z"
---

Today a message needs the recipient agent id. Add a to-repo option to send and mailbox send that resolves to the repo's registered lead. Requested by Ryan via the gateway-repo session.