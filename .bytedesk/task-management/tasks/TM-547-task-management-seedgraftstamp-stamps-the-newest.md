---
id: "TM-547"
kind: "task"
status: "in_progress"
created: "2026-11-01T21:20:20.167Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: seedGraftStamp stamps the newest graft found anywhere, not the graft the session hook runs, so every worktree is still rewritten (TM-507 regression)"
epic: "EP-019"
acceptance: [{"text":"seedGraftStamp stamps the version of the graft on PATH (fallback: the main checkout stamp), never a newer npx-cache or node_modules copy","done":false},{"text":"A unit test with a fake PATH graft at 0.20.0 and an npx-cache graft at 0.21.1 asserts the stamp reads 0.20.0","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "fd2b831f"
branch: "tm/TM-547-task-management-seedgraftstamp-stamps-the-newest"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-547-task-management-seedgraftstamp-stamps-the-newest"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:30:17.726Z"
priority: "high"
touches: ["task-management/CHANGELOG.md","task-management/lib/worktree.mjs","task-management/tests/unit/worktree-graft-stamp.test.mjs"]
comments: [{"author":"main","ts":"2026-11-01T21:20:33.830Z","text":"{\"event\":\"start\",\"at\":\"2026-11-01T21:20:33.723Z\",\"owner\":\"fd2b831f\",\"worktree\":\"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-547-task-management-seedgraftstamp-stamps-the-newest\",\"branch\":\"tm/TM-547-task-management-seedgraftstamp-stamps-the-newest\",\"base_revision\":\"90a9bd4812b3f4349ba24f5b136b72407df14050\",\"base_source\":\"server-tip\",\"intent\":\"Implement TM-547: seedGraftStamp stamps the version of the graft on PATH (fallback main stamp), with a unit test.\",\"boundaries\":[\"task-management/lib/worktree.mjs\",\"task-management/tests/unit/worktree-graft-stamp.test.mjs\",\"task-management/CHANGELOG.md\"],\"dependencies\":[],\"checks\":[\"agent-orchestration: npm ci\",\"agent-orchestration: unit\",\"agent-orchestration: build:check\",\"task-management: unit\",\"agent-orchestration: plugin validate\",\"task-management: plugin validate\",\"plugin-rsync: tests\"],\"files\":[\"task-management/CHANGELOG.md\",\"task-management/lib/worktree.mjs\",\"task-management/tests/unit/worktree-graft-stamp.test.mjs\"]}"},{"author":"main","ts":"2026-11-01T21:30:17.716Z","text":"Third worktree hit (TM-528, 2026-11-01): 16 dirty/untracked files from graft's session refresh blocked the finish report until cleaned; backup at /tmp/tm528-graft-backup/files.tar."}]
governance: {"version":1,"runtime":"topology","workflowRunId":"tm-TM-547","leadId":"fd2b831f","recordPath":"/home/ryan/.local/state/bytedesk/agent-orchestration/management/8890762dbb279261/TM-547.json","state":"working"}
---

Reported by TM-292 worker 4670a51b, 2026-11-01. In worktree tm/TM-292 the graft SessionStart hook rewrote 7 tracked files, created 8 untracked ones, downgraded the wiring 0.21.1 -> 0.20.0 and removed the core.hooksPath SessionStart hook from .claude/settings.json; ao-topology manage report then refused with TOPOLOGY_MANAGEMENT_DIRTY.

Cause (lead fd2b831f): task-management/lib/worktree.mjs seedGraftStamp() picks the NEWEST version among the main stamp (0.20.0), worktree stamps, repo node_modules and ~/.npm/_npx (0.21.1). The hook runs the global nvm graft on PATH (~/.nvm/versions/node/v22.22.0/bin/graft, 0.20.0). Stamp 0.21.1 != running 0.20.0, so graft rewrites. The ponytail comment on the function names exactly this ceiling.

Fix: stamp the version of the graft that the hook will run: resolve graft on PATH (realpath -> its package.json), falling back to the main checkout's stamp version; never take a max over unrelated installs. Repro: npx cache with a newer graft than the global one; tm task new + start; open a session in the worktree; git status is dirty.