---
id: "TM-318"
kind: "task"
status: "open"
created: "2026-10-03T04:06:54.422Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: decide and run the live board cutover to NATS (tm cutover) after the plugin is merged and installed"
epic: "EP-026"
acceptance: [{"text":"Dry-run on a copy of the live board reports equal counts","done":false},{"text":"Cutover run with snapshot taken and tm board/next/start/done verified on NATS","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179"]
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T08:47:48.632Z"
---

Branch nats/integration has tm cutover with count check, snapshot and --dry-run, exercised on temp copies only. Live cutover needs the merged plugin installed in every consumer, a hub with per-agent TM_* creds, and human approval of timing. Remaining gaps: leaf never-online has no copy, claim writes offline need the hub, events() holds all rows in memory.