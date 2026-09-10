---
id: "TM-143"
kind: "task"
status: "in_progress"
created: "2026-09-09T23:42:47.937Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a per-recipient refusal mid-loop persists the envelope and can partially deliver"
epic: "EP-018"
acceptance: [{"text":"A send that is refused for one recipient does not leave that message delivered to any other recipient — either no inbox file is written, or every write is undone, and the chosen mechanism is argued rather than assumed.","done":false},{"text":"The run record does not claim a message that was never delivered to anyone, matching the invariant TM-142 established for broadcast refusals.","done":false},{"text":"A test drives a mid-loop refusal with several recipients ahead of the refused one and asserts on the resulting filesystem, not on the error.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "tm/TM-143-per-recipient-refusal"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-143-refusal"
updated: "2026-09-10T01:55:38.658Z"
---

Scoped out of TM-142 deliberately by its worker, and worth its own task rather than being folded in. TM-142 fixed the BROADCAST refusals (TOPOLOGY_BROADCAST_TOO_WIDE, TOPOLOGY_BROADCAST_EXTERNAL) by resolving addresses before allocating the sequence, so a refused broadcast now leaves run.json byte-identical. But refusals raised INSIDE the per-recipient loop — TOPOLOGY_ROUTE_BLOCKED, TOPOLOGY_UNKNOWN_AGENT, TOPOLOGY_COORDINATOR_NOT_A_WORKER — still throw with the envelope already persisted, and can now throw AFTER some recipients have already had an inbox file written. That is a partial-delivery problem rather than a wasted-envelope one: the sender sees an error, some agents have the message, and the run record says a message exists. It needs a different mechanism from TM-142's reordering — either resolve every recipient's admission before writing any inbox file, or make the per-recipient writes recoverable as a set.