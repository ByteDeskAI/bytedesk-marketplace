---
id: "TM-323"
kind: "task"
status: "blocked"
created: "2026-10-03T04:26:09.420Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management P4: delete generated per-repo launchers and retire the launcher module"
epic: "EP-027"
acceptance: [{"text":"No tracked file under .bytedesk/task-management/{tasks,epics,adrs,evidence,plans,capabilities,sprints,templates} changes in any repo","done":false},{"text":"Launcher dirs are gone in this repo, gateway, paperclip and design-system, and tm, tm-hook and tm-dashboard still work from the global install","done":false},{"text":"Docs, README and project-management.md describe the global install only","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/175"]
blockedBy: ["TM-322"]
blocks: []
actor: "main"
session: "840c43b6-f832-41a8-bb5d-842911ea05f1"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T05:15:08.033Z"
---

Plan phase P4 (/home/ryan/.claude/plans/cozy-orbiting-magpie.md). Only after P2 and P3 are merged everywhere and the pool is restarted on the new code: tm doctor --fix removes generated bin/ and legacy links in each repo; retire the bin gitignore rule; delete or rewrite launcher tests (test-link.sh, test-install.sh, launcher.test.mjs, doctor.test.mjs:496); update docs and .claude/rules/project-management.md. Never touch tasks, epics, adrs, evidence, plans.