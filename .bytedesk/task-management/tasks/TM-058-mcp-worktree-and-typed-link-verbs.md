---
id: "TM-058"
kind: "task"
status: "done"
created: "2026-09-01T20:13:43.711Z"
board: "bytedeskai/bytedesk-marketplace"
title: "MCP worktree and typed-link verbs"
capability: "CAP-0001"
acceptance: [{"text":"tm_worktree new/rm/list exist and refuse the same cases as the CLI","done":true,"at":"2026-09-01T20:35:41.554Z"},{"text":"tm_link writes both ends; tm_unlink leaves both ends clean","done":true,"at":"2026-09-01T20:35:41.660Z"},{"text":"tools/list advertises them; handleRequest tests cover the round trip","done":true,"at":"2026-09-01T20:35:41.787Z"}]
evidence: [".bytedesk/task-management/evidence/TM-058-mcp.test.mjs"]
commits: ["1d51696"]
blockedBy: []
blocks: []
updated: "2026-09-01T20:37:31.200Z"
comments: [{"author":"main","ts":"2026-09-01T20:35:41.896Z","text":"W7: 11 parity tools + delete/restore landed in lib/mcp.mjs; unit + contract suites green (mcp.test 29, test-mcp.sh 70)"}]
actor: "main"
session: "126c1a80-f656-456d-bf04-5c79ad0494c2"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
closed: "2026-09-01T20:37:31.195Z"
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
