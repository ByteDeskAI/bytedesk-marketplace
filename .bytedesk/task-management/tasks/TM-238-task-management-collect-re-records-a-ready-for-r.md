---
id: "TM-238"
kind: "task"
status: "done"
created: "2026-09-24T23:21:09.382Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: collect re-records a ready-for-review worker's result on every pool tick (109 duplicate comments on TM-217)"
epic: "EP-021"
acceptance: [{"text":"Collecting an exited worker whose task is ready-for-review records the result once; a second collect of the same dispatched.run returns ok with nothing written (no comment, no task_result event).","done":true,"at":"2026-09-24T23:31:05.837Z"},{"text":"The idempotence key is the dispatch run, so a later dispatch of the same task (a new review round) is still collected once.","done":true,"at":"2026-09-24T23:31:05.942Z"},{"text":"A unit test runs collect twice on a ready-for-review task with a dead session and asserts exactly one comment and one task_result event.","done":true,"at":"2026-09-24T23:31:06.041Z"},{"text":"The fix includes a one-off cleanup (or a documented tm command) that removes the duplicate worker:tmux comments already on TM-217 and any other affected task, keeping the first.","done":true,"at":"2026-09-24T23:31:06.149Z"}]
evidence: [".bytedesk/task-management/evidence/TM-238-VERIFY.md",".bytedesk/task-management/evidence/TM-238-unit-full.txt"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/tm/TM-238-task-management-collect-re-records-a-ready-for-r","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/126","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/166"]
blockedBy: []
blocks: []
actor: "@main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "tm/TM-238-task-management-collect-re-records-a-ready-for-r"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-238-task-management-collect-re-records-a-ready-for-r"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-10-02T23:51:45.652Z"
priority: "high"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-238","session":"40645e47-066b-4937-abc2-55d42e9ea247","at":"2026-09-24T23:21:15.428Z"}
evidenceSources: {".bytedesk/task-management/evidence/TM-238-VERIFY.md":{"source":"/tmp/tm238/TM-238-VERIFY.md","sha256":"7971337fd1817f0749011055fa0fe212ba773c5f969a069ed12374de8a7339e4","bytes":2204,"at":"2026-09-24T23:31:05.651Z"},".bytedesk/task-management/evidence/TM-238-unit-full.txt":{"source":"/tmp/tm238/TM-238-unit-full.txt","sha256":"d52bfada4c5b0ef4ea1b6b37d2f1ebd4109142664ef4a56a08f684bbb0f77847","bytes":381656,"at":"2026-09-24T23:31:05.751Z"}}
closed: "2026-09-24T23:31:53.554Z"
comments: [{"author":"@dc778cb2","ts":"2026-10-02T19:00:42.861Z","text":"REGRESSION (2026-10-02): comment spam is back — TM-276 has 400+ comments and TM-287 100+ (TM-290 170+). Many are governance/worker event comments; find the writer that repeats."}]
---

Found 2026-09-24 while recording TM-217's review: TM-217 carried 109 identical comments 'tmux worker exited after submitting its revision; independent review and integration remain required' from worker:tmux, and a task_result event per tick in events.jsonl (110 so far). Cause, read at HEAD: collectSession (task-management/lib/dispatch/collect.mjs:255-257) returns recordResult(...'ready-for-review'...) whenever the tmux session is gone and governance.state is ready-for-review. recordResult (collect.mjs:93-137) adds the comment and logs the event but, on the ready-for-review path, changes no state: the task stays in_progress with dispatched.run set, so the next pool tick (collection runs even while the pool is paused) collects the same exited worker again. Every governed task that reaches review while its worker exits will do the same.