---
id: "TM-122"
kind: "task"
status: "open"
created: "2026-09-07T02:06:15.757Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a conductor can acknowledge its bootstrap and then stop"
epic: "EP-017"
acceptance: [{"text":"A conductor that has replied READY begins its mission without a human nudge, demonstrated across repeated launches of the same spec","done":false},{"text":"A run whose orchestrator never sends a first message is reported as stalled rather than looking healthy","done":false}]
evidence: []
commits: ["086830a"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T02:06:25.548Z"
---

An orchestrator read its BOOTSTRAP.md, replied READY, and did nothing further. The run sat with three healthy agents, an empty mailbox and no error until a human nudged it to begin. Non-deterministic: the same spec, same provider and same brief drove itself end to end an hour earlier.

Measured, two runs of showcase-astra-image-pipeline on claude:opus:
- 20260906-213535-puat — launched 01:35:35, sent 001-design-r1 unprompted at 01:36:20, drove all three stages and wrote its report without intervention.
- 20260906-220205-jk95 — launched 02:02:40, replied READY, idle. Nudged 02:04:28; first message 02:04:54, then normal.

This is NOT the submit-key stall (TM-121, fixed). The composer was empty and the READY reply went through; the agent chose to stop.

The instruction is split across two surfaces that pull in opposite directions, and the one it reads LAST is the one that says stop:

  providers/claude.json bootstrap_message:
    'Read <file> and follow it exactly. Reply with the single word READY once you have read it and every skill it lists.'
  BOOTSTRAP.md, line 118 of 118:
    'Begin when you have replied READY: the mission is the inputs above plus the workflow.'

So the pane's own doorbell asks for an acknowledgement and stops there, and the licence to start is the last line of a long document. Reading it as a terminal instruction is a reasonable interpretation, which is why it happens sometimes and not always.

Directions, in order of how much they change:
1. Make the doorbell say it: end bootstrap_message with 'then begin immediately without waiting for another message'. One string, every adapter.
2. Put 'Begin now' at the TOP of BOOTSTRAP.md for an orchestrator, not the bottom.
3. Have the launcher send an explicit begin nudge to the orchestrator after readiness, so starting is an event rather than an inference.

Whichever is chosen, the failure must become visible: a conductor that has not sent a message within N seconds of readiness is a stalled run, and nothing currently says so.