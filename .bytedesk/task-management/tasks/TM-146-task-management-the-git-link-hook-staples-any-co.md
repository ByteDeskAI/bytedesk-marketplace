---
id: "TM-146"
kind: "task"
status: "open"
created: "2026-09-10T01:17:45.900Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: the git-link hook staples any commit made while a task holds the claim onto that task"
acceptance: [{"text":"A commit whose message and branch name no task is not attached to the merely-claimed task","done":false},{"text":"A commit naming a task, or on a tm/<ID>- branch, still attaches as it does today","done":false},{"text":"A test covers the claim-only case, asserting nothing is attached","done":false}]
evidence: []
commits: ["TM-144"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:17:49.378Z"
type: "bug"
labels: ["plugin:task-management"]
---

The commit-side path in `linkGit` resolves its ref with `git rev-parse --short HEAD` at hook time and attaches it to the active claim when the message names no task. So any commit made while a task is claimed is recorded against it, regardless of what the commit touched.

Observed during the TM-140/TM-141 drift reconciliation: both tasks recorded commits `59ca483` and `04d26a6`. Neither carries their fix — `59ca483` is TM-142's merge (mailbox.mjs, topology-addressing.test.mjs) and `04d26a6` is a rules/agent-scaffolding commit. The actual change is `14b3ecd`, merged at `73536a1`. Corrected by hand on both tasks.

This is the same-repo sibling of TM-144. TM-144 fixed cross-repo attribution by reading the repo out of the ref instead of the cwd; within one repo the ref is right and the *task* is wrong. A claim is a statement about who is working, not about what a given commit changed, so it is too weak a signal to attach a ref on its own.

Worth considering: attach on an explicit task mention or a `tm/<ID>-` branch name only, and let a claim-only commit pass unlinked rather than guess. That is what the branch-name case already does correctly.