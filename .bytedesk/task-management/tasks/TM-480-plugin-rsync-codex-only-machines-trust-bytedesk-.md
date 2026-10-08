---
id: "TM-480"
kind: "task"
status: "in_progress"
created: "2026-10-08T23:08:29.086Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: Codex-only machines trust bytedesk hooks without a TUI approval"
epic: "EP-028"
acceptance: [{"text":"a fresh Codex session with plugin-rsync's hook untrusted ends with the hook trusted, no TUI","done":false},{"text":"the MCP start never recurses or delays the session; a lock bounds concurrent trust runs","done":false}]
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
updated: "2026-10-08T23:08:39.459Z"
---

On a fresh Codex-only machine no plugin hook is trusted, so plugin-rsync's SessionStart hook (which would trust the rest) never runs. Codex starts plugin MCP servers without per-hook trust, so ship a minimal plugin-rsync MCP server that, on start, runs trust-codex-hooks (and the Grok repair) detached, with a lock so the app-server it spawns cannot recurse.