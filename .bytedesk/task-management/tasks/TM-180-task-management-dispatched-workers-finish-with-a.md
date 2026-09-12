---
id: "TM-180"
kind: "task"
status: "done"
created: "2026-09-11T19:43:00.967Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: dispatched workers finish with a pushed branch and a PR; update docs"
epic: "EP-021"
acceptance: [{"text":"the handoff instructs commit, git push -u origin <tm branch>, gh pr create with the TM key in the title, then tm evidence and tm done","done":true,"at":"2026-09-12T01:46:36.690Z"},{"text":"collect records the PR URL on the task when gh finds one and still succeeds when gh is absent","done":true,"at":"2026-09-12T01:46:36.836Z"},{"text":"docs describe computed readiness, the ready-for-human veto, pool on by default, the worker guard and the PR finish line; no doc says the label is only applied by hand","done":true,"at":"2026-09-12T01:46:36.979Z"},{"text":"CHANGELOG.md has an entry naming the EP and TM keys; no version field is added to any Claude manifest","done":true,"at":"2026-09-12T01:46:37.119Z"},{"text":"node --test task-management/tests/unit exits 0, including agent-first-docs.test.mjs; claude plugin validate ./task-management passes without --strict","done":true,"at":"2026-09-12T01:46:37.274Z"}]
evidence: [".bytedesk/task-management/evidence/TM-180-VERIFY.md"]
commits: ["59e72e4"]
blockedBy: ["TM-177","TM-178"]
blocks: []
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-12T02:07:26.632Z"
labels: ["ready-for-agent"]
triagedBy: "auto"
parkedReason: "not abandoned: Agent-tool worker w-finish is live on its own worktree branch, built on top of the unmerged TM-178 branch. Parked only because the Stop gate re-blocks every turn (its once-only release state is store-wide and other sessions' stops clear it). Lead resumes with tm start TM-180 when the worker reports."
comments: [{"author":"main","ts":"2026-09-11T21:58:45.786Z","text":"worker w-finish was stopped by accident and cannot be resumed; its work survives in worktree .claude/worktrees/agent-a63fd5d76aaa94ddb (branch worktree-agent-a63fd5d76aaa94ddb, merge 3b92ae4 + 15 uncommitted files). New worker w-finish2 continues in that same worktree."},{"author":"main","ts":"2026-09-12T01:46:37.810Z","text":"merged to main as 59e72e4; lead wrote the pool doc sections (f240f1f) the worker left as placeholders, against the merged code."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-180-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-180-VERIFY.md","sha256":"56ac75940cbcc9a4a6c57321a0cd35bea425c7367bb8a493ddc21851cde93457","bytes":3198,"at":"2026-09-12T01:46:37.558Z"}}
closed: "2026-09-12T01:46:38.120Z"
---

Workers end at tm done in their worktree; a human pushes. Decision (Ryan 2026-09-11): the worker pushes its tm/<id> branch and opens a PR; a human merges. Change the handoff in lib/render.mjs:358-364; collect records the PR URL via gh pr list --head <branch> --json url, tolerating a missing gh. Update README.md:186-191, AGENTS.md:47-50, docs/agent-first.md, docs/use-cases.md, skills/pool, skills/tickets, skills/groom, .claude/rules/project-management.md and CHANGELOG.md for the whole epic; keep tests/unit/agent-first-docs.test.mjs in step.