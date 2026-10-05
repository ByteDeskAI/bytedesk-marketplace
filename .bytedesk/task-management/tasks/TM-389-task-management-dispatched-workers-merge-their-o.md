---
id: "TM-389"
kind: "task"
status: "in_progress"
created: "2026-10-05T11:07:09.429Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: dispatched workers merge their own PR; plugin edits auto-rsync to installed caches"
epic: "EP-028"
acceptance: [{"text":"worker-guard allows gh pr merge <own branch> / bare gh pr merge on own branch, refuses numbers and other branches, with tests","done":false},{"text":"ungoverned worker handoff and docs describe review, checks, merge own PR","done":false},{"text":"post-commit/post-merge hooks in scripts/git-hooks rsync touched plugins from the main checkout","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2e1a5469-e106-4fa6-a7ed-35e999950137"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T11:07:20.399Z"
---

Operator policy 2026-10-05: sessions and dispatched workers carry a plan to done without human intervention. The worker guard refuses gh pr merge outright and the handoff tells workers a human merges. Allow a worker to merge its OWN PR (named by its branch, or none from the branch checked out) after review and green checks; keep refusing merges by number or of any other branch. Separately, plugin edits in the marketplace main checkout must reach the installed Claude/Codex/Grok caches without a manual plugin-rsync.