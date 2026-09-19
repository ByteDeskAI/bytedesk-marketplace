---
id: "TM-201"
kind: "task"
status: "done"
created: "2026-09-13T21:31:49.164Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: dispatch branches a worker off whatever the checkout has checked out, not a defined base"
epic: "EP-021"
acceptance: [{"text":"a dispatch provisions its worktree from a defined base (default branch, or a configured dispatch.base), not from the checkout's current HEAD","done":true,"at":"2026-09-13T22:02:14.485Z"},{"text":"the dispatched record stores the base ref and SHA, and tm show surfaces it","done":true,"at":"2026-09-13T22:02:14.640Z"},{"text":"a test dispatches while the checkout sits on an unrelated feature branch and asserts the worker branch contains no commit from it","done":true,"at":"2026-09-13T22:02:14.764Z"},{"text":"the handoff and any PR name the base the work was built on","done":true,"at":"2026-09-13T22:02:14.900Z"}]
evidence: [".bytedesk/task-management/evidence/TM-201-dispatch-base.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/119"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-201"
branch: "tm/TM-201-task-management-dispatch-branches-a-worker-off-w"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-201-task-management-dispatch-branches-a-worker-off-w"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-13T22:07:24.860Z"
comments: [{"author":"main","ts":"2026-09-13T21:43:17.455Z","text":"Second thing the first live run exposed, same area: every dispatched worktree comes back dirty before the worker does anything. The graft plugin's session start writes .claude/settings.json (statusLine, subagentStatusLine, extra permissions) into each worktree, and TM-198's also picked up .claude/helpers/graft-*.cjs. A worker that stages with git add -A will commit that noise into its branch and its PR. Either provision should ignore or restore harness-written files, or the handoff must tell workers to stage only what they changed."}]
dispatched: {"backend":"tmux","run":"tmux:tm-TM-201","session":"pool-tm-201","at":"2026-09-13T21:43:23.815Z"}
evidenceSources: {".bytedesk/task-management/evidence/TM-201-dispatch-base.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-201-dispatch-base.md","sha256":"c6b8345fe4a3724c9b1504354fa6c0f3edd95a56ab86eb9581e879d059955c7e","bytes":5652,"at":"2026-09-13T22:06:55.745Z"}}
closed: "2026-09-13T22:07:24.856Z"
---

Found on the pool's first live run (2026-09-13). The three dispatched workers (TM-188, TM-193, TM-198) were each provisioned from the main checkout's current HEAD, which another session had parked on its feature branch feat/dispatch-duplicate-guard. Each tm/TM-* branch is therefore 12 commits ahead of main and carries that session's unrelated work, including commit 1668292. Consequences: a worker's PR diff contains another session's commits; a worker tests against a tree nobody asked it to test; and if that branch is abandoned or rewritten, the worker's base disappears. lib/worktree.mjs provision() should branch from a defined base — the configured default branch, or origin/main, or at minimum the branch the task records — and the dispatch record should store the base SHA so collect and any PR can state what the work was built on. Unattended dispatch cannot depend on where a human happens to have left the checkout.