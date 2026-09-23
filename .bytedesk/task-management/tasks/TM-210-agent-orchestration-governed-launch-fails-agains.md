---
id: "TM-210"
kind: "task"
status: "open"
created: "2026-09-23T22:21:27.975Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: governed launch fails against a busy lead with no proof in the last 10 minutes"
epic: "EP-019"
acceptance: [{"text":"The chosen behaviour is recorded as an ADR or a comment on this task by a person.","done":false},{"text":"Under the chosen behaviour, a launch against a busy lead whose ack arrives inside the grace window either succeeds without a manual retry or refuses with text naming the missing proof and when to retry.","done":false},{"text":"A test covers the late-ack case.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-human","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-09-23T22:21:44.294Z"
---

The launch gates (topology/lib/launch.mjs:854, 1235) call leadState with the 30s probe. Mail admission (standing-mailbox.mjs:117-131) uses stored proof only, valid 10 minutes (RESPONSIVE_TTL_MS, lead.mjs:237). TM-157 rings the pane and TM-161 accepts late acks, but the ring is skipped on a busy pane (delivery.mjs:349-352). So TOPOLOGY_STARTUP_NOT_READY / leads_not_ready is timing-dependent: a retry can succeed only because the lead took a turn in between. Filed for a human decision: whether launch should queue, retry within a grace window, or keep failing fast with a better message.