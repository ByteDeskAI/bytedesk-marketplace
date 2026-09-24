---
id: "TM-235"
kind: "task"
status: "in_progress"
created: "2026-09-24T22:43:43.712Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: dispatched workers open PRs against the repo default branch, not dispatch.integrationBranch"
epic: "EP-021"
acceptance: [{"text":"When dispatch.integrationBranch names a branch, the worker's finish-line instruction includes --base <that branch>; a render test asserts it.","done":false},{"text":"The worker guard refuses a gh pr create whose --base is missing or differs from dispatch.integrationBranch, and its refusal names the expected base; a worker-guard test covers missing, wrong and correct base.","done":false},{"text":"When integrationBranch is unset or HEAD, dispatch resolves it to a concrete branch recorded on the task, or refuses to dispatch with a message naming the config key; it never lets gh fall back to the repo default silently.","done":false},{"text":"README and docs/agent-first.md describe the rule, and the CHANGELOG entry names this incident.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-236"]
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "tm/TM-235-task-management-dispatched-workers-open-prs-agai"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-09-24T23:06:10.781Z"
priority: "highest"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-235","session":"40645e47-066b-4937-abc2-55d42e9ea247","at":"2026-09-24T22:43:54.819Z"}
touches: ["task-management/CHANGELOG.md","task-management/README.md","task-management/bin/tm-hook","task-management/docs/agent-first.md","task-management/lib/dispatch/index.mjs","task-management/lib/dispatch/tmux.mjs","task-management/lib/render.mjs","task-management/lib/worker-guard.mjs","task-management/lib/worktree.mjs","task-management/tests/unit/dispatch.test.mjs","task-management/tests/unit/result.test.mjs","task-management/tests/unit/worker-guard.test.mjs"]
---

Reported by gateway lead d60f0608 on 2026-09-24, with real damage: a dispatched worker in bytedesk-remote-gateway opened PR 227 against main although that repo sets dispatch.integrationBranch=develop. It was merged without checking the base, which put unreleased develop commits on the release branch; Ryan is resetting main. Verified here by reading: new worktrees branch from integrationBranch (lib/dispatch/worktree.mjs), but the finish-line instruction a worker receives (lib/render.mjs:384) is 'gh pr create --title ... --body ...' with no --base, so gh targets the repository default branch. The worker guard (lib/worker-guard.mjs) allows any gh pr create and never checks its base. The config default is 'HEAD' (README.md:1248), which names no branch a PR can target.