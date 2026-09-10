---
id: "TM-146"
kind: "task"
status: "done"
created: "2026-09-10T01:17:45.900Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: the git-link hook staples any commit made while a task holds the claim onto that task"
acceptance: [{"text":"A commit whose message and branch name no task is not attached to the merely-claimed task","done":true,"at":"2026-09-10T02:12:16.302Z"},{"text":"A commit naming a task, or on a tm/<ID>- branch, still attaches as it does today","done":true,"at":"2026-09-10T02:12:16.417Z"},{"text":"A test covers the claim-only case, asserting nothing is attached","done":true,"at":"2026-09-10T02:12:16.536Z"}]
evidence: [".bytedesk/task-management/evidence/TM-146-HANDOFF-TO-INTEGRATOR.md"]
commits: ["2545066","8e387d3","a31042c","fa18b8c","578498b","b0732c9"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:22:22.177Z"
type: "bug"
labels: ["plugin:task-management"]
evidenceSources: {".bytedesk/task-management/evidence/TM-146-TM-146-HANDOFF-TO-INTEGRATOR.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-146-gitlink/.bytedesk/task-management/evidence/TM-146-HANDOFF-TO-INTEGRATOR.md","sha256":"980f68337db698e298dc92afad263fa4c3056ee05fef2d9a035af145e3c5e37e","bytes":4374,"at":"2026-09-10T02:12:16.649Z"}}
comments: [{"author":"main","ts":"2026-09-10T02:17:27.919Z","text":"MERGED at 8e387d3. Gates on the merged tree with exit codes captured: task-management unit 1364/1364; hooks 65, hooks2 33, store 134, link 13, capability 22, concurrency 12, events 12, install 13, mcp 77, read 59 — all exit 0. agent-orchestration unit 504/500 pass/4 skipped and build:check exit 0, though this merge touches zero agent-orchestration files.\n\ntest-pool exits 1 with 17 pass / 2 fail. NOT this branch. Reproduced in the canonical checkout on unmodified main BEFORE this merge was staged, and identical after — that is TM-153.\n\nTRAP TESTS VERIFIED NON-VACUOUS INDEPENDENTLY: the branch test file alone, over an unmodified archive of main, fails exactly its 2 new assertions — the claim-only commit attaching nothing, and that refusal being on the record rather than silent.\n\nTHE FIX WAS ALSO VERIFIED IN PRODUCTION, by accident and then deliberately. 01f7bd4, the churn commit made minutes before the merge with the old code, stamped itself onto TM-146 and TM-147 — two tasks it has nothing to do with. 8e387d3, the merge commit itself, made with the fixed code on disk, stamped NOTHING. Before and after, on the same machine, in the same checkout. Then the git_link_unattributed emission was confirmed by driving hooks/tm-hook.sh post-bash directly with a claim-only commit payload: the event count went 1 to 2 and the record carries the branch and the reason.\n\nTWO AUTHOR FINDINGS WORTH KEEPING, both correct:\n\nThe cross-repo guard had to move ABOVE attribution. Without the reorder the change broke TM-036 test — a wrong-repo PR naming no task returned early as nothing-to-attach and never logged git_link_skipped. Whether a ref belongs to this board is a fact about the ref; which task it names is a separate question, and that order keeps each refusal meaning what it says.\n\nAdding an event kind to bin/tm is a two-file change: lib/ntfy.mjs carries a catalog that must list every emitted kind, and ntfy.test.mjs is the only thing that tells you. Registered at min priority beside git_link_skipped, because most commits in a repository are not a task evidence.\n\nTHE WIDENING TO gh pr create WAS APPROVED, not silently taken. It composes with TM-144 rather than colliding: TM-144 fixed how the PR ref is DERIVED, reading the repo out of the URL; it left TARGET selection alone, so that path carried a correct ref pointed at a possibly-wrong task.\n\nFILED AS TM-154, found while verifying this: linkGit reads only the command string, so a commit authored with -F or a heredoc attaches nothing however clearly its message names the task. TM-146 did not cause it — the claim fallback used to mask it by guessing right often enough. 8e387d3 is the example: its subject names TM-146 and it attached to nothing. Every commit in this integrator session uses -F, so the whole integration record is currently unattributed. TM-154 adds the message as a second EXPLICIT signal without restoring the guess."}]
closed: "2026-09-10T02:17:28.048Z"
---

The commit-side path in `linkGit` resolves its ref with `git rev-parse --short HEAD` at hook time and attaches it to the active claim when the message names no task. So any commit made while a task is claimed is recorded against it, regardless of what the commit touched.

Observed during the TM-140/TM-141 drift reconciliation: both tasks recorded commits `59ca483` and `04d26a6`. Neither carries their fix — `59ca483` is TM-142's merge (mailbox.mjs, topology-addressing.test.mjs) and `04d26a6` is a rules/agent-scaffolding commit. The actual change is `14b3ecd`, merged at `73536a1`. Corrected by hand on both tasks.

This is the same-repo sibling of TM-144. TM-144 fixed cross-repo attribution by reading the repo out of the ref instead of the cwd; within one repo the ref is right and the *task* is wrong. A claim is a statement about who is working, not about what a given commit changed, so it is too weak a signal to attach a ref on its own.

Worth considering: attach on an explicit task mention or a `tm/<ID>-` branch name only, and let a claim-only commit pass unlinked rather than guess. That is what the branch-name case already does correctly.