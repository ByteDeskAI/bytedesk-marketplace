---
id: "TM-447"
kind: "task"
status: "done"
created: "2026-10-05T15:36:59.989Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: cross-repo pool ensure and runTm children inherit the filer's AO identity"
epic: "EP-028"
acceptance: [{"text":"runTm children and poolEnv drop AO_AGENT_ID, AO_SESSION_* and other AO identity variables","done":true,"at":"2026-10-09T00:13:37.028Z"},{"text":"A test proves B's pool env has no AO_AGENT_ID","done":true,"at":"2026-10-09T00:13:37.399Z"}]
evidence: [".bytedesk/task-management/evidence/TM-447-1791504817766.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:13:38.117Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T16:19:33.298Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ f15b8fd4 (independent re-review rv-222); final round drops the TM-460 since-shortcut"},{"author":"main","ts":"2026-10-05T16:24:44.324Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ 7dd1f3f8 (independent delta review rv-222: both findings closed)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-447-1791504817766.log":{"source":null,"sha256":"e1ce15667ece98f982c63dbb363bc39289e3b59435a129a7f25ca685b607cd9a","bytes":162,"at":"2026-10-09T00:13:37.766Z"}}
closed: "2026-10-09T00:13:38.112Z"
---

rv-197 on #197: wakePool runs the target's pool ensure with the filer's env; poolEnv strips TM_* but not AO_AGENT_ID, so B's pool runs as worker W and mails as W.