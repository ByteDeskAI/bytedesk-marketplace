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
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/119","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/125"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-201"
branch: "tm/TM-201-task-management-dispatch-branches-a-worker-off-w"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-201-task-management-dispatch-branches-a-worker-off-w"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T23:17:41.005Z"
comments: [{"author":"main","ts":"2026-09-13T21:43:17.455Z","text":"Second thing the first live run exposed, same area: every dispatched worktree comes back dirty before the worker does anything. The graft plugin's session start writes .claude/settings.json (statusLine, subagentStatusLine, extra permissions) into each worktree, and TM-198's also picked up .claude/helpers/graft-*.cjs. A worker that stages with git add -A will commit that noise into its branch and its PR. Either provision should ignore or restore harness-written files, or the handoff must tell workers to stage only what they changed."},{"author":"@main","ts":"2026-09-24T23:14:30.059Z","text":"Found while working TM-235 (same file, dispatch PR base): TM-201's board status is 'done' with commits pointing at PR #119, but PR #119 is verified still OPEN (state=OPEN, mergedAt=null, mergeCommit=null via `gh pr view 119`) and its sole commit d306df2 lives only on the unmerged branch tm/TM-201-... — it never landed on main. `git log --all -- lib/worktree.mjs` shows no TM-201 commit in the file's real history; the current dispatch.integrationBranch mechanism (added later, in c0a66d6, an unrelated governed-execution commit) is a different, simpler scheme than PR #119's resolveBase()/dispatch.base/origin-default-branch chain. PR #119 is also now stale against main (predates taskPlacement/governance). Note: PR #119 never added a gh pr create --base flag either way — it only appends a 'Built on <ref>' sentence to the PR body — so it would not have covered TM-235's bug even if merged. Not fixing this myself (out of TM-235's scope); flagging so someone decides whether to rebase-and-land #119, close it, or fold dispatch.base into dispatch.integrationBranch."}]
dispatched: {"backend":"tmux","run":"tmux:tm-TM-201","session":"pool-tm-201","at":"2026-09-13T21:43:23.815Z"}
evidenceSources: {".bytedesk/task-management/evidence/TM-201-dispatch-base.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-201-dispatch-base.md","sha256":"c6b8345fe4a3724c9b1504354fa6c0f3edd95a56ab86eb9581e879d059955c7e","bytes":5652,"at":"2026-09-13T22:06:55.745Z"}}
closed: "2026-09-13T22:07:24.856Z"
---

Found on the pool's first live run (2026-09-13). The three dispatched workers (TM-188, TM-193, TM-198) were each provisioned from the main checkout's current HEAD, which another session had parked on its feature branch feat/dispatch-duplicate-guard. Each tm/TM-* branch is therefore 12 commits ahead of main and carries that session's unrelated work, including commit 1668292. Consequences: a worker's PR diff contains another session's commits; a worker tests against a tree nobody asked it to test; and if that branch is abandoned or rewritten, the worker's base disappears. lib/worktree.mjs provision() should branch from a defined base — the configured default branch, or origin/main, or at minimum the branch the task records — and the dispatch record should store the base SHA so collect and any PR can state what the work was built on. Unattended dispatch cannot depend on where a human happens to have left the checkout.