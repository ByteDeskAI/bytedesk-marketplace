---
id: "TM-408"
kind: "task"
status: "done"
created: "2026-10-05T13:44:35.582Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: agents pull their next assignment from their lead autonomously; leads assign from the board, never ask the operator what is next"
epic: "EP-028"
acceptance: [{"text":"prompts/common.md and the lead/worker role templates state the pull rule: workers ask their repo lead for the next assignment; leads pick and dispatch from their own board","done":true,"at":"2026-10-09T02:50:32.372Z"},{"text":"Leads never end a turn asking the operator what to do next; with nothing ready they report the board state once and idle","done":true,"at":"2026-10-09T02:50:32.858Z"},{"text":"The supervisor nudges an idle agent at a safe boundary: workers to ask their lead, leads to take the next ready task","done":true,"at":"2026-10-09T02:50:33.300Z"},{"text":"A test shows an idle worker sending a next-assignment request to its lead and a lead dispatching a ready task without operator input","done":true,"at":"2026-10-09T02:50:33.773Z"}]
evidence: [".bytedesk/task-management/evidence/TM-408-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/214","71bead63"]
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-09T02:56:33.239Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T14:31:03.587Z","text":"Worker done at bf3bbaf4; PR #214 -> fix/ao-local-nats-autostart; independent review running."},{"author":"main","ts":"2026-10-05T14:57:26.541Z","text":"Review round-1 fixes at 29976e21 (min idle 10/30 min from end of work, change-gated repeats with doubling backoff, persisted nudge memory, consistent prompts); re-review running."},{"author":"review-sweep","ts":"2026-10-06T15:45:32.834Z","text":"review-sweep: PR #214 \"TM-408: agents pull their next assignment from their lead; supervisor idle nudge\" has had no activity for 24h — needs an independent review or a decision."},{"author":"review-sweep","ts":"2026-10-09T02:56:07.119Z","text":"review-sweep: TM-408 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T02:56:33.232Z","text":"Independent review verdict: approved (PR #214, round 3 APPROVE at 8ff37c31 plus cost-fix APPROVE at 5b1f2f6f, lead-dispatched reviewer review-214) — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/214#issuecomment-6073247563"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-408-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-408-landing.md","sha256":"8c8ad5282a3d9b25586d8337130f5af06c02d1cb684dabc61d1efac52ed6326a","bytes":648,"at":"2026-10-09T02:50:34.246Z"}}
closed: "2026-10-09T02:50:34.703Z"
---

Operator rule (Ryan, 2026-10-05): an agent that finishes its work never asks the operator "what next?". It pulls its next assignment up the chain, autonomously:
- A worker, reviewer or other standing agent asks its own repository lead (via `ao-topology mailbox send` to the lead) what it is assigned next, and waits on its inbox.
- A repository lead does not ask anyone: it reads its own board (`tm next`, ready-for-agent, blocked, stale in_progress), assigns or dispatches the next work itself, and reports to the operator only finished results, blockers that need a "still ask" action, or decisions only the operator can make.
- If a lead has nothing ready, it says so once (with the board state) and goes idle; it does not end its turn with a question to the operator.

Evidence: the agent-fabric lead (Hana Braith, c2c984bc) was faulted by the operator for ending a turn with "what's next on the board?" instead of acting on it.

Make it persistent in the plugin, not in one agent's memory: put it in the common protocol (prompts/common.md) and the lead and worker role templates, and have the supervisor nudge an idle agent with "ask your lead for your next assignment" (workers) or "pick the next ready task" (leads) at its next safe boundary.