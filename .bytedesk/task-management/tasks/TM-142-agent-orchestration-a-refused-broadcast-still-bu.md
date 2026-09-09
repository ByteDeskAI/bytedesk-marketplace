---
id: "TM-142"
kind: "task"
status: "open"
created: "2026-09-09T23:11:13.303Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a refused broadcast still burns a sequence number and persists an envelope"
epic: "EP-018"
acceptance: [{"text":"A refused broadcast leaves the run record byte-identical: no envelope persisted, no sequence number consumed. Proven by a test that captures run.json before and after a refusal and compares.","done":false},{"text":"The fix does not move expansion before the external computation — that ordering is required, since expansion needs the run and the refusal depends on external. Validate the audience shape and the recipient count before allocating, or roll the allocation back on refusal; say which and why.","done":false},{"text":"The external-sender refusal specifically cannot be used to grow another repository's run.json, since that is the adversarial case.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-09T23:11:13.310Z"
---

Raised by the TM-133 worker against its own change, and accepted as a real defect rather than waved through. Address expansion needs the run record, so it must run after loadRun/nextSequence; but nextSequence allocates the message sequence and sendMessage persists message_envelopes[id] before the per-recipient loop. So a broadcast refused by TOPOLOGY_BROADCAST_TOO_WIDE or TOPOLOGY_BROADCAST_EXTERNAL leaves an envelope and a consumed sequence number behind for a message that was never delivered to anyone. Nothing is misdelivered and no admission is bypassed — the refusal is correct — but the run record accumulates envelopes for messages that do not exist, and the sequence numbers have gaps that a reader may interpret as lost messages. This matters most for the external-sender refusal, which is the adversarial path: an outsider can grow another repo's run.json by repeatedly addressing an audience it is not allowed to address.