---
id: "TM-044"
kind: "task"
status: "open"
created: "2026-07-31T05:23:36.457Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The work stream renders Claude Code's transcript; Codex and Grok were only parsed"
epic: "EP-004"
acceptance: [{"text":"A Codex rollout and a Grok chat history render in the panel, looked at rather than assumed","done":false},{"text":"Tool calls and results from all three formats are legible side by side","done":false},{"text":"A format that changes under us degrades to text rather than rendering nothing","done":false}]
evidence: []
commits: ["6c9e01a"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T05:24:18.410Z"
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
