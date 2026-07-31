---
id: "TM-006"
kind: "task"
status: "done"
created: "2026-07-29T23:08:50.395Z"
title: "There is no way back from done, so the store reopens itself wrongly and doctor certifies it"
epic: "EP-002"
acceptance: [{"text":"reopening a task clears closed, so exports stop showing a Resolved date on open work","done":true,"at":"2026-07-29T23:31:50.096Z"},{"text":"reopening a task reopens its auto-closed epic","done":true,"at":"2026-07-29T23:31:50.135Z"},{"text":"auto-closing the active epic clears activeEpic, so new tasks cannot file into it","done":true,"at":"2026-07-29T23:31:50.176Z"},{"text":"tm reopen exists, and tm start on a done task says it reopened","done":true,"at":"2026-07-29T23:31:50.219Z"},{"text":"doctor catches a done epic with live children and a closed date on open work","done":true,"at":"2026-07-29T23:31:50.263Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/61"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-29T23:31:50.314Z"
labels: ["store-cli","rank-03"]
priority: "low"
comments: [{"author":"main","ts":"2026-07-29T23:08:50.518Z","text":"Build plan (from the ranked survey): lib/store.mjs update() (line 426): when the patch moves a task OUT of RESOLVED (store.mjs:494) and the stored doc was in it, fold closed: undefined into the patch — serializeDoc (store.mjs:51-54) filters undefined, so the key leaves the frontmatter — and call a new reopenEpic(t.epic, p). Gate the epic half on the same config(p).autoCloseEpics !== false that autoCloseEpic (store.mjs:307) checks, or a user who turned auto-close off gets writes they never asked for. | reopenEpic(epicId, p) beside autoCloseEpic (store.mjs:307-316): a done epic goes back to open with closed: undefined, logs epic_reopened. The update() branch must be kind-aware (kindOf(id) === 'task') so reopenEpic's own update(epicId, {status:'open'}) cannot re-enter itself. | autoCloseEpic clears state.activeEpic when it closes the active epic, matching what tm epic done already does at bin/tm:163. This is the line that stop"},{"author":"main","ts":"2026-07-29T23:08:50.559Z","text":"Watch out for: update() is the funnel for bin/tm, dashboard-api transition, mcp tm_task_update and doctor's own fixes — which is why the guard belongs there and not in tm reopen, but also means all four now get a write they did not request. Hold it to exactly two things: dropping closed, and the config-gated epic flip. tm done on an already-done task still re-runs release/unblockDependents and logs a second done event — note it, do not fix it here. If the PR has to shrink, the store guard plus the activeEpic c"}]
closed: "2026-07-29T23:31:50.313Z"
---

