---
id: "TM-321"
kind: "task"
status: "blocked"
created: "2026-10-03T04:26:08.398Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management P2: global resolver scripts, doctor/init changes, bare-tm text, version-aware pool"
epic: "EP-027"
acceptance: [{"text":"A clean-install sandbox (env -i, copied plugin) writes no launchers and tm resolves through the resolver script","done":false},{"text":"Simulated plugin update: ensurePool replaces the old-version pool; a worker spawned after cache GC still gets a working guard hook","done":false},{"text":"No skill, hint or doc string names .bytedesk/task-management/bin; the stale ~/.local/bin symlinks into the Codex cache are detected by doctor","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/175"]
blockedBy: ["TM-320"]
blocks: ["TM-322"]
actor: "main"
session: "840c43b6-f832-41a8-bb5d-842911ea05f1"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T05:15:07.514Z"
---

Plan phase P2 (/home/ryan/.claude/plans/cozy-orbiting-magpie.md). Stop writeLaunchers in init and session-start. Doctor removes owned generated bin/, .bytedesk/bin and dead or stale global links (drop the plugin.autolink gate). One real (non-symlink) resolver script per command at ~/.local/bin for Codex, Kimi and Grok that follows plugin updates. Skills and hint text use bare tm. TM_PLUGIN_ROOT and TM_ROOT passed to workers. pool.pid records plugin root and version and a stale pool is replaced. Worker guard hook path resolves the current plugin.