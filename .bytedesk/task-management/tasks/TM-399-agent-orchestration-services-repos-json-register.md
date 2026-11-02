---
id: "TM-399"
kind: "task"
status: "open"
created: "2026-10-05T12:32:02.427Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: services repos.json registers /tmp scratchpad directories as repositories"
epic: "EP-028"
acceptance: [{"text":"Registering a consumer under the OS temp dir is refused, or pruned when the path no longer exists","done":false},{"text":"services ensure prunes registrations whose path is gone, logging each","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T12:32:02.437Z"
---

2026-10-05: ~/.local/state/bytedesk/agent-orchestration/services/repos.json holds 5 consumers under /tmp/claude-1000/.../scratchpad/ (gw334/c-*, hp-codex, hp-claude, hp-grok), so services run a supervisor per throwaway test dir. Registration should refuse (or prune) consumers under the OS temp dir and paths that no longer exist.