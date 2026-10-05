---
id: "TM-320"
kind: "task"
status: "open"
created: "2026-10-03T04:26:07.906Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management P1: fail-closed repo resolution, --repo, and an opt-in gate"
epic: "EP-027"
acceptance: [{"text":"tm run from /tmp, from a submodule, and with a stale CLAUDE_PROJECT_DIR refuses with an error naming --repo; --repo from outside a repo works; no store is created in any of those cases","done":false},{"text":"Hook payload cwd inside a worktree: store, branch and actor all come from the same repo (covers TM-190); tm-hook guard uses resolveRoot","done":false},{"text":"Uninitialized repo: dashboard, session-start, pool and MCP create nothing (find .bytedesk is empty); existing stores in this repo and the three sibling repos still initialize because config.json exists; doctor flags a store without one","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/175"]
blockedBy: []
blocks: ["TM-321"]
actor: "main"
session: "840c43b6-f832-41a8-bb5d-842911ea05f1"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T04:56:03.614Z"
touches: [".claude/worktrees/agent-a51c514d28ccada9b/task-management/CHANGELOG.md",".claude/worktrees/agent-a51c514d28ccada9b/task-management/bin/tm",".claude/worktrees/agent-a51c514d28ccada9b/task-management/lib/dispatch/pool.mjs",".claude/worktrees/agent-a51c514d28ccada9b/task-management/lib/mcp.mjs",".claude/worktrees/agent-a51c514d28ccada9b/task-management/lib/paths.mjs",".claude/worktrees/agent-a51c514d28ccada9b/task-management/tests/test-worktree.sh",".claude/worktrees/agent-a51c514d28ccada9b/task-management/tests/unit/helpers.mjs",".claude/worktrees/agent-a51c514d28ccada9b/task-management/tests/unit/paths.test.mjs",".claude/worktrees/agent-a51c514d28ccada9b/task-management/tests/unit/repo-resolution.test.mjs",".claude/worktrees/agent-a51c514d28ccada9b/task-management/tests/unit/store.test.mjs"]
comments: [{"author":"main","ts":"2026-10-03T04:44:57.036Z","text":"P1 implemented on branch tm/TM-320-fail-closed-repo-resolution (commit 0aa27c8c, worktree .claude/worktrees/agent-a51c514d28ccada9b), not pushed. Lead re-ran tests/unit/repo-resolution.test.mjs: 16/16 pass. Worker reported unit suite 1606 pass/0 fail and 15 guard mutations each caught. Open: test-mcp.sh tool-count failure (39 vs 45) claimed to pre-exist on origin/main, not yet verified by the lead; bytedesk-remote-gateway's config.json is gitignored (root .gitignore:8), so a fresh gateway clone would count as uninitialized under the new rule."},{"author":"main","ts":"2026-10-03T05:15:11.890Z","text":"PR opened: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/175 (base main). Still blocked on the gateway config.json decision."},{"author":"main","ts":"2026-10-04T04:56:03.608Z","text":"Gateway question resolved: ByteDeskAI/bytedesk-remote-gateway#336 un-ignores and tracks .bytedesk/task-management/config.json (base develop). Remaining: review and merge marketplace#175, then merge gateway#336 (either order; a gateway clone without config.json only needs it after #175 lands)."}]
---

Plan phase P1 (/home/ryan/.claude/plans/cozy-orbiting-magpie.md). resolveRoot, currentCheckout and CHECKOUT take one explicit repo input (--repo, hook cwd) and agree. Refuse when ambiguous: no git work tree and no store, submodule, CLAUDE_PROJECT_DIR vs cwd mismatch, TM_ROOT set but missing, MCP call with no repo. isInitialized means config.json exists. tm-hook release guard goes through resolveRoot. MCP gets repo context. Verify each blind spot against current main first; 4c3698b5 already guards the dashboard.