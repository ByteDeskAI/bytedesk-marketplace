---
id: "TM-088"
kind: "task"
status: "done"
created: "2026-09-05T04:00:58.746Z"
board: "bytedeskai/bytedesk-marketplace"
title: "ADR: which orchestration layer is authoritative, and who owns the worktree"
epic: "EP-014"
acceptance: [{"text":"ADR records the chosen layer, the rejected alternative, and the reasoning","done":true,"at":"2026-09-05T07:29:29.798Z"},{"text":"Worktree ownership is stated: which component provisions, which reuses, and the two-worktrees-per-task duplication is resolved or explicitly accepted","done":true,"at":"2026-09-05T07:29:29.914Z"},{"text":"The fate of the four tm dispatch backends is stated (orchestration, fleet, tmux, manual)","done":true,"at":"2026-09-05T07:29:30.036Z"}]
evidence: [".bytedesk/task-management/evidence/TM-088-0001-authoritative-orchestration-layer.md"]
commits: ["8f135ad","d547b0e"]
blockedBy: []
blocks: ["TM-096","TM-098","TM-099"]
actor: "main"
session: "b0124774-6c67-41ff-9359-e1a31565e734"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:29:30.275Z"
type: "spike"
closed: "2026-09-05T07:29:30.271Z"
---

agent-orchestration ships two unrelated orchestrators: the MCP runtime in src/ (systemd transient scopes, Bubblewrap+slirp4netns, hash-chained events.ndjson, detached git worktree with tamper checks) and the tmux topology layer in topology/ (panes, file mailbox, no isolation of any kind). Zero code coupling in either direction, different run stores, different ID formats; topology runs are invisible to all 14 orchestration_* MCP tools because store.list() filters on the run_<uuid> regex. Retiring fleet forces the decision rather than allowing it to wait: fleet gave tm dispatch worktree isolation, a visible tmux session, transcript observation and depth-based auth together, and neither ao layer has that set. Record the decision and the rejected alternative as an ADR, and settle worktree ownership in the same document — today tm provisions a worktree and the backend derives its own underneath, abandoning tm's.