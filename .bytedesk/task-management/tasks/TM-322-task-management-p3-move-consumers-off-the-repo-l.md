---
id: "TM-322"
kind: "task"
status: "blocked"
created: "2026-10-03T04:26:08.896Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management P3: move consumers off the repo-local launcher (agent-orchestration, gateway, hook examples)"
epic: "EP-027"
acceptance: [{"text":"management.mjs works with no repo-local launcher present (new test omits tmBin)","done":false},{"text":"Gateway PR merged: the Tasks overlay starts a dashboard with launchers deleted","done":false},{"text":"Codex hook runs end to end through the ~/.local/bin resolver; Kimi and Pi examples updated and exercised, or explicitly marked untested","done":false}]
evidence: []
commits: []
blockedBy: ["TM-321"]
blocks: ["TM-323"]
actor: "main"
session: "840c43b6-f832-41a8-bb5d-842911ea05f1"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T04:26:11.181Z"
---

Plan phase P3 (/home/ryan/.claude/plans/cozy-orbiting-magpie.md). agent-orchestration topology/lib/management.mjs:51 calls bare tm with TM_ROOT set (keep the tmBin override) plus a test that omits tmBin. bytedesk-remote-gateway src/task_management_project.go resolves the plugin's tm-dashboard (separate PR in that repo). Codex, Kimi and Pi hook examples, rewriteLegacyCodexHooks and bytedesk-agent-mail/.codex/hooks.json use the new form.