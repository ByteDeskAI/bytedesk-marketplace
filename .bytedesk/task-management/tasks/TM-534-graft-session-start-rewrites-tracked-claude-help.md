---
id: "TM-534"
kind: "task"
status: "open"
created: "2026-10-11T05:50:20.370Z"
board: "bytedeskai/bytedesk-marketplace"
title: "graft session start rewrites tracked .claude/helpers/graft-hooks.cjs (baked absolute install path) and adds GEMINI.md/opencode.json, dirtying every worktree"
epic: "EP-029"
acceptance: [{"text":"A fresh worktree session start leaves git status clean (no graft-hooks.cjs diff, no GEMINI.md/opencode.json)","done":false},{"text":"No tracked file under .claude/ contains an absolute /home path","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","tech-debt"]
triagedBy: "auto"
updated: "2026-10-11T06:07:16.087Z"
priority: "medium"
comments: [{"author":"main","ts":"2026-10-11T06:07:16.077Z","text":"More evidence (lead, 2026-10-11, main checkout): graft also rewrote .claude/settings.json, deleting the SessionStart hook that sets core.hooksPath=scripts/git-hooks (the plugin-rsync auto-sync) and adding a statusLine plus graft-dev permissions; it also edited graft-statusline.cjs, .claude/skills/graft/SKILL.md and .grok/skills/graft/SKILL.md. The lead restored the .claude files (backup: /tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/253de95a-5b3d-4702-b941-9b7ba0507f01/scratchpad/graft-churn-main-2026-10-11.patch). Separately, AGENTS.md and CLAUDE.md gained a duplicate design-patterns-context block (installer churn), left in place for its owner."}]
---

Found by the TM-324 rework worker, 2026-10-11. On session start in a worktree, graft rewrote the tracked file .claude/helpers/graft-hooks.cjs, changing const BAKED from the volta install path to the nvm one (/home/ryan/.nvm/versions/node/v22.22.0/...), and created untracked GEMINI.md and opencode.json. The clean-tree gate on manage finish then refuses, so the worker had to back the churn up (/tmp/TM-324-graft-wiring-churn) and remove it by hand. Two defects: (1) a committed file holds a machine-specific absolute home path, which the shared plugin rules forbid, and its value depends on which node is first on PATH; (2) graft's per-session wiring writes into worktrees. Fix on our side: stop tracking the machine-specific helper (ignore it and let graft generate it, or resolve the graft path at runtime instead of baking it), and ignore GEMINI.md/opencode.json if graft is meant to write them. If graft itself must change, file it with graft's owner.