---
id: "TM-446"
kind: "task"
status: "done"
created: "2026-10-05T15:36:59.239Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY tm ticket executes a launcher at a task-supplied origin path"
epic: "EP-028"
acceptance: [{"text":"notify and file never execute code from origin.repo or a target path; only this plugin's own tm runs, with TM_ROOT pointing at the target","done":true,"at":"2026-10-09T00:13:33.985Z"},{"text":"An origin outside the AO registry or sibling rules is refused and logged","done":true,"at":"2026-10-09T00:13:34.385Z"},{"text":"Regression test with a planted bin/tm proves it never runs","done":true,"at":"2026-10-09T00:13:34.806Z"}]
evidence: [".bytedesk/task-management/evidence/TM-446-1791504815224.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:21:46.557Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T16:19:32.904Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ f15b8fd4 (independent re-review rv-222); final round drops the TM-460 since-shortcut"},{"author":"main","ts":"2026-10-05T16:24:43.954Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ 7dd1f3f8 (independent delta review rv-222: both findings closed)"},{"author":"review-sweep","ts":"2026-10-06T16:25:54.817Z","text":"review-sweep: PR #224 \"TM-446 TM-447 TM-448 TM-449 TM-460 TM-450: ticket launcher, AO identity, passEnv trust, collect hold, review LOWs\" has had no activity for 24h — needs an independent review or a decision."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-446-1791504815224.log":{"source":null,"sha256":"e1ce15667ece98f982c63dbb363bc39289e3b59435a129a7f25ca685b607cd9a","bytes":162,"at":"2026-10-09T00:13:35.226Z"}}
closed: "2026-10-09T00:13:35.641Z"
---

rv-197 on #197, reproduced: tm task new --origin '{"repo":"/tmp/evil"}' then 'AO_AGENT_ID=lead-123 tm done' ran /tmp/evil/.bytedesk/task-management/bin/tm with the lead's env. notifyOrigin/runTm prefer the target's own launcher; the pool's collect path runs it too. Same for fileTicket's path target.