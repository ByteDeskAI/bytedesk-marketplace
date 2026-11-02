---
id: "TM-516"
kind: "task"
status: "blocked"
created: "2026-10-09T05:19:47.017Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO MCP T3: review_run_checks: the host runs required checks at the request revision outside every pane tree, sharing one runner with integrate"
epic: "EP-029"
acceptance: [{"text":"Evidence matches the TM-216 shape [{name, argv, exit_code, revision, duration_ms, log_tail}], and a failing check returns evidence rather than throwing","done":false},{"text":"A check that dumps its environment shows no session variables, and one that walks /proc finds no reviewer or lead pane ancestor","done":false},{"text":"A required_checks value written by a worker on the branch is ignored","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/248","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/254"]
blockedBy: ["TM-427","TM-505"]
blocks: ["TM-511"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:52:39.819Z"
priority: "high"
---

Design detail: .bytedesk/task-management/evidence/EP-autonomy/audit-mcp.md section 5 (T3). Update the affected role prompts to prefer the MCP tool and keep the CLI as a fallback. Tests must fail on an empty result. Reviewers cannot run checks, so they block for missing evidence. Split runRequiredChecks (management.mjs:974) into a non-throwing collector with an env allowlist (PATH, HOME, LANG; drop AO_*, TM_*, CLAUDE*, TMUX*, GH_*, GITHUB_TOKEN, NATS_*), run it outside the pane tree (systemd-run --user --wait --pipe --collect, or the repo supervisor), and use it from both review_run_checks and integrate (:1008, :1173). Revision from the request packet only; checks only from default-branch config (TM-505). This also closes the hole where integrate's checks run worker code inside the lead's pane, which passes the TM-427 pane proof. Depends on TM-427 and TM-505.