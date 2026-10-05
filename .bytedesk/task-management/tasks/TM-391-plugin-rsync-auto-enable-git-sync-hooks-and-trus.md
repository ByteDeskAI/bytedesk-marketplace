---
id: "TM-391"
kind: "task"
status: "in_progress"
created: "2026-10-05T11:25:26.427Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: auto-enable git sync hooks and trust bytedesk hooks in Codex and Grok sessions"
epic: "EP-028"
acceptance: [{"text":"SessionStart hook in plugin-rsync sets core.hooksPath in a fresh checkout under Claude, Codex and Grok","done":false},{"text":"plugin-rsync trusts untrusted bytedesk Codex hooks after a Codex sync, proven against a stale hash","done":false}]
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
updated: "2026-10-05T11:30:06.614Z"
---

Make the TM-389 plugin auto-rsync work for Codex and Grok, not only Claude: a plugin SessionStart hook sets core.hooksPath in marketplace checkouts; Codex hook trust is written through its app-server so new hooks run without TUI approval.