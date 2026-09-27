---
id: "TM-227"
kind: "task"
status: "blocked"
created: "2026-09-24T21:08:02.858Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: console control verbs approve and send-back"
epic: "EP-021"
acceptance: [{"text":"approve and send-back accepted only for runs in awaiting_approval, with attributed actor; journal events; unit tests","done":false},{"text":"send-back delivers the notes to the lead via the existing message path and moves the run to a new iteration","done":false},{"text":"Gateway can flip orchProducerApprove on; contract documented","done":false}]
evidence: []
commits: []
blockedBy: ["TM-226"]
blocks: ["TM-228"]
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:26:40.416Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:40.410Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): serves gateway TM-444 (EP-027 P0, landed): the gateway approve endpoint returns 501 until this lands and the orchProducerApprove switch is flipped. Also serves TM-448 (P4, parked)."}]
---

For gateway EP-027 P0/P4 (TM-444 approve endpoint returns 501 until this exists; gateway switch orchProducerApprove). workflow-control.mjs:245 accepts only launch, message, review, failover, stop, retry. Add approve (operator approval of a run in awaiting_approval, attributed actor, starts the approve pipeline) and send-back (operator notes go to the run's lead and the run starts a new iteration). Both refuse runs not in awaiting_approval.