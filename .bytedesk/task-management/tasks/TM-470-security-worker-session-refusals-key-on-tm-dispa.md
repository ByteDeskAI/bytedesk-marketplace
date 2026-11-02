---
id: "TM-470"
kind: "task"
status: "done"
created: "2026-10-05T16:42:12.297Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY worker-session refusals key on TM_DISPATCH_WORKER, which a worker can unset"
epic: "EP-028"
acceptance: [{"text":"One shared isWorkerCaller predicate decides by recorded dispatch ancestry, not env alone","done":true,"at":"2026-10-09T06:10:31.591Z"},{"text":"env -u TM_DISPATCH_WORKER from the worker's pane is still classified as a worker (test)","done":true,"at":"2026-10-09T06:10:31.974Z"},{"text":"All worker refusals use that predicate (grep test, rule 3)","done":true,"at":"2026-10-09T06:10:32.442Z"}]
evidence: [".bytedesk/task-management/evidence/TM-470-1791526232896.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/230"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T06:10:33.779Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T17:45:47.519Z","text":"rv-222 on #226: the task-management copy of the merge-in gate (governedCompletion in tm) runs in whoever calls tm, so a worker with 'env -u TM_DISPATCH_WORKER PATH=/tmp/fake:$PATH tm done X' controls its gh answer; the ao copy in the lead's integrate path is the real gate. Contained by this task."},{"author":"main","ts":"2026-10-08T23:48:20.551Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/230 (independent security review rv-230: C1 forged registry record releases guard; H1 hidden command names; H2 retargeting; M1 ancestry escapes; server-side fix TM-489)"},{"author":"main","ts":"2026-10-09T06:10:33.342Z","text":"review verdict: approved on design review — Ryan chose to merge PR #230 without the bypass probes (2026-10-09). https://github.com/ByteDeskAI/bytedesk-marketplace/pull/230"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-470-1791526232896.log":{"source":null,"sha256":"3a148fe3002cff3d100fd1c9606709c0db5fbff384d3c8c9af05ea80e9f336f9","bytes":309,"at":"2026-10-09T06:10:32.897Z"}}
closed: "2026-10-09T06:10:33.769Z"
---

Residual from PR #226 and #224 reviews: config set, manage, and claim marking refuse or mark a worker by TM_DISPATCH_WORKER, an env var the worker controls. Needs a proof the worker cannot remove: process ancestry from the worker's tmux session/pane recorded at dispatch, as TM-411/TM-222 use ancestry.