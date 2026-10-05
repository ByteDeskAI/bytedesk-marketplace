---
id: "TM-278"
kind: "task"
status: "open"
created: "2026-10-02T01:11:18.500Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox send accepts a dry-run flag and ignores it, queueing a real message"
epic: "EP-023"
acceptance: [{"text":"A dry run on mailbox send prints destination repo, resolved lead and delivery or hold reason and writes no envelope, or the flag is rejected with a named error","done":false},{"text":"A test fails if a dry run leaves any record in the outbox or standing mailbox","done":false},{"text":"Every other send verb is grepped and either shares the behavior or shows the flag rejected","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "81e61d16-ae0f-495c-a2a4-7148fc8fa898"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T05:15:35.420Z"
---

ao-topology mailbox send with a dry-run flag queued a real envelope (id x, body x, d60f0608 to fd2b831f), held as unknown_recipient because no consumer was given, then retried on backoff. cli.mjs handles dry-run only for the permissions verbs; mailbox send has no handling, so the flag is silently ignored. Fix: either resolve routing and print the decision (destination repo, lead, delivery or hold reason) with no envelope written, or reject the flag. Check every sibling send verb for the same silent acceptance. Reported by the gateway lead via the gateway-repo session.