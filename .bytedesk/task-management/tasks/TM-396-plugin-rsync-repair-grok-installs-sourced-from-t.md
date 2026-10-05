---
id: "TM-396"
kind: "task"
status: "in_progress"
created: "2026-10-05T12:28:45.072Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: repair Grok installs sourced from the marketplace root on every machine"
epic: "EP-028"
acceptance: [{"text":"plugin-rsync fix-grok-installs reinstalls root-sourced Grok entries from <root>/<plugin> and is a no-op otherwise","done":false},{"text":"the plugin-rsync SessionStart hook runs it in the background in any repo, without delaying the session","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2e1a5469-e106-4fa6-a7ed-35e999950137"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T12:29:01.100Z"
---

Grok installs whose Local source is the marketplace root (seen: task-management, knowledge-management) copy the whole repo incl. ~27 GB of .bytedesk/worktrees on each start and time out loading plugins, so no hooks run. Detect and reinstall them from their plugin folders automatically from the plugin-rsync session hook, on any machine.