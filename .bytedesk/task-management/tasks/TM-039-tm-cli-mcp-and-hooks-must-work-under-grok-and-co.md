---
id: "TM-039"
kind: "task"
status: "open"
created: "2026-07-31T02:21:19.592Z"
title: "tm CLI, MCP and hooks must work under Grok and Codex CLI, not just Claude Code"
epic: "EP-003"
acceptance: [{"text":"tm resolves its store and session under Grok and Codex CLI, not only when CLAUDE_CODE_SESSION_ID is set","done":false},{"text":"The MCP server registers and answers from both .codex-mcp.json and the Grok equivalent","done":false},{"text":"Hooks either fire on each tool's lifecycle or degrade without blocking the session","done":false},{"text":"The dashboard's work stream names its source per tool, or says it has none","done":false},{"text":"A capability matrix in the README says what works where, tested rather than assumed","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T02:21:31.056Z"
---

## Problem
Everything in this plugin assumes Claude Code. Session identity reads CLAUDE_CODE_SESSION_ID,
the hooks are wired to Claude Code lifecycle events, and TM-035 just shipped a work stream that
reads a transcript from ~/.claude/projects. Under Grok or Codex CLI the store still works, but
claims, gates, attribution and the work stream are all inert — and nothing says so.

## Proposal
Audit each surface (CLI, MCP, hooks, dashboard) against Grok and Codex CLI. Where a tool has an
equivalent, use it; where it does not, degrade honestly rather than silently. The plugin already
ships .codex-plugin and .codex-mcp manifests, so the Codex half is partly wired and untested.
