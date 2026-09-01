---
id: "TM-058"
kind: "task"
status: "open"
created: "2026-09-01T20:13:43.711Z"
board: "bytedeskai/bytedesk-marketplace"
title: "MCP worktree and typed-link verbs"
capability: "CAP-0001"
acceptance: [{"text":"tm_worktree new/rm/list exist and refuse the same cases as the CLI","done":false},{"text":"tm_link writes both ends; tm_unlink leaves both ends clean","done":false},{"text":"tools/list advertises them; handleRequest tests cover the round trip","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
updated: "2026-09-01T20:13:43.718Z"
---

Implements [[CAP-0001]].


## Problem / job-to-be-done

After BDM-74 the dashboard and CLI can provision a `.bytedesk/worktrees/` checkout and drop a typed link from both ends. An agent that only has MCP still cannot. tm_sprint and tm_cap_drop shipped; tm_worktree / tm_link / tm_unlink did not. The store's contract is the same gates on every surface — this is the hole that remains.

## Current state

CLI `tm worktree new|rm` and `POST /api/task/:id/worktree` call createWorktree / removeWorktree. `removeLink` plus `POST /unlink` clean both ends. MCP tools/list has no worktree or typed-link verb, so an MCP-only session has to shell out.

## Proposed enhancement

Add `tm_worktree` (new / rm / list) and `tm_link` / `tm_unlink` that call the same lib functions the CLI and dashboard already use. Drive them through handleRequest on a temp store. Do not invent a sixth kanban column or serve worktree file contents.

## Acceptance criteria

- [ ] tm_worktree new/rm/list exist and refuse the same cases as the CLI
- [ ] tm_link writes both ends; tm_unlink leaves both ends clean
- [ ] tools/list advertises them; handleRequest tests cover the round trip

## Non-goals

- Kanban cards for worktrees
- Serving worktree file contents
- Two-sided writes into a foreign board
