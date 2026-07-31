---
id: "TM-039"
kind: "task"
status: "done"
created: "2026-07-31T02:21:19.592Z"
title: "tm CLI, MCP and hooks must work under Grok and Codex CLI, not just Claude Code"
epic: "EP-003"
acceptance: [{"text":"tm resolves its store and session under Grok and Codex CLI, not only when CLAUDE_CODE_SESSION_ID is set","done":true,"at":"2026-07-31T03:59:58.952Z"},{"text":"The MCP server registers and answers from both .codex-mcp.json and the Grok equivalent","done":true,"at":"2026-07-31T03:59:59.023Z"},{"text":"Hooks either fire on each tool's lifecycle or degrade without blocking the session","done":true,"at":"2026-07-31T04:00:31.152Z"},{"text":"The dashboard's work stream names its source per tool, or says it has none","done":true,"at":"2026-07-31T03:59:59.098Z"},{"text":"A capability matrix in the README says what works where, tested rather than assumed","done":true,"at":"2026-07-31T03:59:59.163Z"}]
evidence: [".bytedesk/task-management/evidence/TM-039-sessions.mjs"]
commits: []
blockedBy: []
blocks: ["TM-042"]
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T04:00:54.655Z"
comments: [{"author":"main","ts":"2026-07-31T04:00:54.593Z","text":"Every harness fact was read off the installed CLIs (codex-cli 0.146.0, grok 0.2.117), never a doc: env names out of the shipped binaries, transcript layouts off session files the tools had already written here. That found a live defect — CODEX_SESSION_ID was in the fallback chain and exists nowhere in Codex, so it read as support and never matched. Codex sessions are ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread>.jsonl (response_item/message/function_call); Grok's are ~/.grok/sessions/<percent-encoded-cwd>/<id>/chat_history.jsonl. Both now parse into the same UIMessage shape the panel already renders, and the panel names which CLI it read from. Hooks: Claude only — verified they exit 0 rather than blocking under Codex/Grok. Codex's own .codex/hooks.json surface is real but its payload schema is unverified, so it is TM-042 rather than a guess."}]
closed: "2026-07-31T04:00:54.654Z"
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
