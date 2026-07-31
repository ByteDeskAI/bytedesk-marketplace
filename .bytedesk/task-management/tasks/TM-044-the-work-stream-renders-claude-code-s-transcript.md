---
id: "TM-044"
kind: "task"
status: "done"
created: "2026-07-31T05:23:36.457Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The work stream renders Claude Code's transcript; Codex and Grok were only parsed"
epic: "EP-004"
acceptance: [{"text":"A Codex rollout and a Grok chat history render in the panel, looked at rather than assumed","done":true,"at":"2026-07-31T05:35:38.031Z"},{"text":"Tool calls and results from all three formats are legible side by side","done":true,"at":"2026-07-31T05:35:38.107Z"},{"text":"A format that changes under us degrades to text rather than rendering nothing","done":true,"at":"2026-07-31T05:35:38.171Z"}]
evidence: [".bytedesk/task-management/evidence/TM-044-transcript.mjs"]
commits: ["6c9e01a","a389cb8"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T05:40:12.293Z"
comments: [{"author":"main","ts":"2026-07-31T05:35:38.309Z","text":"Looked at, not assumed. Served a scratch board under CODEX_THREAD_ID pointed at a real rollout, and under GROK_SESSION_ID pointed at a real chat_history.jsonl, and opened the drawer in a browser both times. Codex first render was flooded by its own injected preamble — recommended_plugins, AGENTS.md, environment_context — thousands of characters before any work, so the run was buried inside it; those are dropped now. Grok rendered but every tool call showed {} because its argument keys are target_file/target_directory, and Codex's is cmd, none of which were in the allowlist. Paths were absolute and repeated, now shortened to the project root: knowledge-management/README.md rather than forty characters of prefix. Codex now reads as prompt to exec_command to result to answer; Grok as WRITE/RUN_TERMINAL_COMMAND/SEARCH_REPLACE with their targets. Also capped any single message and added a raw-text fallback so a format change shows the file rather than an empty panel that reads as idle."}]
closed: "2026-07-31T05:35:38.374Z"
---

## Problem
TM-039 proved the reader: 40, 6 and 7 real messages parsed out of live Claude Code, Codex and Grok
transcripts. It did not prove the *panel*. The only work stream ever looked at in a browser was
Claude Code's, in TM-035.

Parsing into the right shape and rendering legibly are different claims. A Codex `function_call`
carries its arguments as a JSON string; a Grok entry carries tool calls alongside content. Both map
to the same UIMessage, and neither has been seen on screen.

## Proposal
Drive the board under each harness — the fixtures and the live transcripts both exist — and look.
Fix what reads badly. The bar is legibility, not polish.
