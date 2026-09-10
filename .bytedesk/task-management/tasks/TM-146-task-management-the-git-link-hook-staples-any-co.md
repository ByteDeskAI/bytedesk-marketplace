---
id: "TM-146"
kind: "task"
status: "blocked"
created: "2026-09-10T01:17:45.900Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: the git-link hook staples any commit made while a task holds the claim onto that task"
acceptance: [{"text":"A commit whose message and branch name no task is not attached to the merely-claimed task","done":true,"at":"2026-09-10T02:12:16.302Z"},{"text":"A commit naming a task, or on a tm/<ID>- branch, still attaches as it does today","done":true,"at":"2026-09-10T02:12:16.417Z"},{"text":"A test covers the claim-only case, asserting nothing is attached","done":true,"at":"2026-09-10T02:12:16.536Z"}]
evidence: [".bytedesk/task-management/evidence/TM-146-TM-146-HANDOFF-TO-INTEGRATOR.md"]
commits: ["TM-144","a05c993","eac8ae7","df1af22","9c765c3","f57062a","2772d30"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T02:12:16.774Z"
type: "bug"
labels: ["plugin:task-management"]
evidenceSources: {".bytedesk/task-management/evidence/TM-146-TM-146-HANDOFF-TO-INTEGRATOR.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-146-gitlink/.bytedesk/task-management/evidence/TM-146-HANDOFF-TO-INTEGRATOR.md","sha256":"980f68337db698e298dc92afad263fa4c3056ee05fef2d9a035af145e3c5e37e","bytes":4374,"at":"2026-09-10T02:12:16.649Z"}}
blockedReason: "Code complete, gated and handed to the integrator. Branch tm/TM-146-git-link-claim-fallback off main@fb1558c, code commit 2545066. The claim fallback is gone from linkGit; only a TM-nnn in the command or a tm/<ID>- branch attaches a ref, and a command naming neither records git_link_unattributed. Fixed for gh pr create as well as git commit, agreed with the integrator and stated in the code. The cross-repo guard now runs before attribution, or a wrong-repo PR naming no task would stop logging git_link_skipped. lib/ntfy.mjs carries the new event in its catalog. Gates: 1364/1364 unit; every bash suite clean except test-pool.sh, which fails identically in the canonical checkout and in a worktree carrying none of these changes and passes only in a detached copy — filed as TM-153, not this branch's. New test fails 2 against unmodified main. Blocked on the integrator's merge only."
---

The commit-side path in `linkGit` resolves its ref with `git rev-parse --short HEAD` at hook time and attaches it to the active claim when the message names no task. So any commit made while a task is claimed is recorded against it, regardless of what the commit touched.

Observed during the TM-140/TM-141 drift reconciliation: both tasks recorded commits `59ca483` and `04d26a6`. Neither carries their fix — `59ca483` is TM-142's merge (mailbox.mjs, topology-addressing.test.mjs) and `04d26a6` is a rules/agent-scaffolding commit. The actual change is `14b3ecd`, merged at `73536a1`. Corrected by hand on both tasks.

This is the same-repo sibling of TM-144. TM-144 fixed cross-repo attribution by reading the repo out of the ref instead of the cwd; within one repo the ref is right and the *task* is wrong. A claim is a statement about who is working, not about what a given commit changed, so it is too weak a signal to attach a ref on its own.

Worth considering: attach on an explicit task mention or a `tm/<ID>-` branch name only, and let a claim-only commit pass unlinked rather than guess. That is what the branch-name case already does correctly.