---
id: "TM-419"
kind: "task"
status: "done"
created: "2026-10-05T14:25:10.967Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: arrival ring (TM-351) announces old, already-handled or invisible standing messages to a lead pane"
epic: "EP-028"
acceptance: [{"text":"The arrival ring only rings for messages that 'mailbox inbox' for that agent would show as unread, and never for handled, deferred, archived or other-agent messages","done":true,"at":"2026-10-05T15:27:48.935Z"},{"text":"Each message rings at most once, persisted across supervisor restarts","done":true,"at":"2026-10-05T15:27:49.548Z"},{"text":"A test replays a backlog of old handled messages and asserts zero rings","done":true,"at":"2026-10-05T15:27:50.140Z"}]
evidence: [".bytedesk/task-management/evidence/TM-419-1791214070576.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/217"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:57.915Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-419-1791214070576.log":{"source":null,"sha256":"33bbeba0e76f9d35b262ff81838a7dee5c091d9c56c78e92593a0256e00088f8","bytes":368,"at":"2026-10-05T15:27:50.577Z"}}
closed: "2026-10-05T15:27:51.209Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:29:00.143Z","text":"review-sweep: TM-419 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:57.910Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/217 (independent post-merge review rv-216)"}]
---

Observed 2026-10-05 ~14:10 on the marketplace lead pane (fd2b831f), right after the main checkout fast-forwarded to fdd82990 (bringing #191 TM-351 arrival rings live). The pane received about 20 rings '[ao] Standing message <id> from <sender>: read it with ao-topology mailbox inbox ...' for ids that are NOT in 'mailbox inbox' and NOT in 'mailbox receipts' for fd2b831f: observer:* messages from b3004241 (including observer:status-update:2026-09-17T0813), demo-1790799977-ping from demo-gw, nats-ping-2 and nats-ping-1790799520 from nats-check, and d60f0608's gw-gap1..4, gw-gap-nudge-1, cleo-review-126-127-reply2, tm168-role-icon-countersignature-reply, tm482-followup-landing-defect (all handled or answered weeks ago). The ring is reading a different source than the inbox (another transport, an archive, or messages addressed via other stores) and has no 'already rung / already handled' memory. Result: a ring storm on a live lead's composer and pointers that lead nowhere.