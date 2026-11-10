---
id: "TM-559"
kind: "task"
status: "open"
created: "2026-11-10T21:07:50.619Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration mailbox: a cross-repo message held as unknown_recipient still rings the recipient's pane, so the bell names a message the inbox cannot show"
epic: "EP-029"
acceptance: [{"text":"A send to an agent id registered in another repository either delivers to that repository's inbox or is refused at send time naming --consumer <repo>","done":false},{"text":"No bell is rung for a message the recipient's inbox command will not show","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "72f1fc09-2253-4281-a926-682424a11029"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-10T21:08:02.357Z"
priority: "high"
---

2026-11-10 ~20:00Z the infrastructure lead aad9e97d sent an urgent message (id 44ded73c-4170-49bd-9cd7-ca4ed64a5a79) to the marketplace lead fd2b831f. The recipient's pane got the bell ('[ao] Standing message 44ded73c-... from aad9e97d ... read it with ao-topology mailbox inbox --consumer /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace --agent fd2b831f'), but that inbox command did not list it. The record at ~/.local/state/bytedesk/agent-orchestration/standing-mailbox/messages/8bb0bc5abc539dfa7ee1a7a4e5e6c97fd556d2d7ef9dd785e6ec4733c6ff8199.json has status held, reason unknown_recipient, repositoryId null: the send did not resolve the recipient's repository. The lead found it only by grepping the state dir. Two defects: (1) a send to an agent of another repository with no or the wrong --consumer is held instead of resolved or refused at send time with the fix named; (2) the bell is rung for a message the inbox cannot show, so the recipient cannot read an urgent message. Expected: refuse the send with the command that would work (mailbox send --consumer <recipient repo>), or resolve the agent id across registered consumers; never ring for a held message, or make inbox list held messages addressed to the agent. Related: TM-544.