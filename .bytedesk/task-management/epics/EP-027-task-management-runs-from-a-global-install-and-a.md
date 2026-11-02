---
id: "EP-027"
kind: "epic"
status: "open"
created: "2026-10-03T04:26:07.350Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management runs from a global install and acts on repo-relative files"
actor: "main"
session: "840c43b6-f832-41a8-bb5d-842911ea05f1"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-10-03T04:26:07.358Z"
---

Install task-management once, globally. No generated per-repo launchers. Each repo keeps tasks, epics, adrs, evidence, plans, capabilities, sprints, templates and config.json in .bytedesk/task-management/. Plan: /home/ryan/.claude/plans/cozy-orbiting-magpie.md. Phases: P1 safety, P2 resolver and discovery, P3 consumers, P4 removal. Re-baselined against origin/main 99898b33: 4c3698b5 already stops the dashboard creating a store in an uninitialized repo, but isInitialized is still only existsSync(base). Overlaps EP-026 (pluggable TM storage): this epic keeps data in .bytedesk/task-management.