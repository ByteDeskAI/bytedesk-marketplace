---
id: "TM-480"
kind: "task"
status: "done"
created: "2026-10-08T23:08:29.086Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: Codex-only machines trust bytedesk hooks without a TUI approval"
epic: "EP-028"
acceptance: [{"text":"a fresh Codex session with plugin-rsync's hook untrusted ends with the hook trusted, no TUI","done":true,"at":"2026-10-08T23:10:29.457Z"},{"text":"the MCP start never recurses or delays the session; a lock bounds concurrent trust runs","done":true,"at":"2026-10-08T23:10:29.793Z"}]
evidence: [".bytedesk/task-management/evidence/TM-480-evidence.txt"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/227","32733ea7"]
blockedBy: []
blocks: []
actor: "main"
session: "2e1a5469-e106-4fa6-a7ed-35e999950137"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:23:22.173Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-480-evidence.txt":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2e1a5469-e106-4fa6-a7ed-35e999950137/scratchpad/TM-480-evidence.txt","sha256":"10956bc055053110a6251e443506a195af9360a6e8d6452719844b2c4ddf9346","bytes":357,"at":"2026-10-08T23:10:30.181Z"}}
closed: "2026-10-08T23:10:30.519Z"
comments: [{"author":"review-sweep","ts":"2026-10-08T23:19:26.205Z","text":"review-sweep: TM-480 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-08T23:23:22.168Z","text":"Independent post-merge review verdict on PR #227: changes requested (lead-dispatched reviewer rv-227, 2026-10-08). HIGH: the trust filter (plugin-rsync:229) re-trusts any hook whose pluginId ends in @bytedesk, including trustStatus 'modified', and #227 makes it run at every Codex session start in any directory with no approval — Codex's modified-hook protection is effectively off for @bytedesk hooks (widens #187). HIGH: plugin-rsync-mcp:17 also runs fix-grok-installs, which reinstalls any local marketplace's plugins with --trust, now with zero prior approval (widens #188). MEDIUM: codex/grok resolved via inherited PATH from untrusted project dirs. Tracked with TM-485."}]
---

On a fresh Codex-only machine no plugin hook is trusted, so plugin-rsync's SessionStart hook (which would trust the rest) never runs. Codex starts plugin MCP servers without per-hook trust, so ship a minimal plugin-rsync MCP server that, on start, runs trust-codex-hooks (and the Grok repair) detached, with a lock so the app-server it spawns cannot recurse.