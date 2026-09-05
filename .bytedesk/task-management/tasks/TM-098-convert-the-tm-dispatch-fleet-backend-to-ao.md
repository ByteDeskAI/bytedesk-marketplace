---
id: "TM-098"
kind: "task"
status: "blocked"
created: "2026-09-05T04:02:08.688Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Convert the tm dispatch fleet backend to ao"
epic: "EP-014"
acceptance: [{"text":"Dispatching a task through the former fleet path works end to end against ao","done":false},{"text":"Whatever fleet provided and the chosen layer lacks is either replaced or explicitly dropped with the reason recorded","done":false},{"text":"Worktree ownership follows the ADR rather than producing a second worktree per task","done":false},{"text":"The fleet backend and its host-capability gate are removed from the backend list","done":false}]
evidence: []
commits: []
blockedBy: ["TM-088"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:02:32.048Z"
---

fleet is retired as a plugin but its tm dispatch backend converts to ao rather than being deleted, so dispatches keep working and the dependency goes. This is not a swap: fleet gave tm dispatch worktree isolation, a visible tmux session per ticket, JSONL transcript observation and depth-based authorization together, and neither ao layer has that set - the MCP layer loses the visible session, topology loses the worktree and sandbox. The target layer comes from the ADR. The raw tmux backend is also a candidate for collapsing into ao, since topology does the same job better. Watch the worktree duplication: ao's MCP layer derives its own detached worktree under tm's provisioned one, the same shape fleet had, so the waste moves rather than resolving unless ownership is settled.