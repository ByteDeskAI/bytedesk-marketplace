---
id: "TM-220"
kind: "task"
status: "open"
created: "2026-09-24T20:42:02.627Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: refuse to collect a failed request; mention note in approve refusal"
epic: "EP-021"
acceptance: [{"text":"collectReview refuses a failed request without escalating again; unit test","done":false},{"text":"Approve refusal message names minor, nit and note","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T21:27:52.065Z"
comments: [{"author":"main","ts":"2026-09-24T21:27:52.059Z","text":"Add to reviewer follow-ups: reviewer.md must tell the reviewer to escape double quotes inside JSON strings (or use single quotes when quoting code). 2026-09-24 Cleo's TM-444 approval (nonce b73a0c42) was invalid JSON because evidence quoted a code comment with bare \" characters; collection correctly refused it."}]
---

From Faro's recorded TM-215 approval (nonce b0d19bf7). (1) minor, reviewer.mjs ~960: collectReview has no guard for a request in state failed; ao-topology reviewer collect (cli.mjs:434) can re-parse it, escalating again or, once the refused copy scrolls out, recording a verdict under the failed nonce. Refuse collection of failed requests. (2) nit, reviewer.mjs ~713: the approve refusal message lists minor or nit but not note.