---
id: "TM-465"
kind: "task"
status: "done"
created: "2026-10-05T15:54:46.777Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY mailbox wait returns a reply only to the message's sender"
epic: "EP-028"
acceptance: [{"text":"MCP wait by a non-sender is refused with TOPOLOGY_SENDER_MISMATCH and returns no body","done":true,"at":"2026-10-09T00:26:07.594Z"},{"text":"The CLI wait applies the same check","done":true,"at":"2026-10-09T00:26:07.977Z"},{"text":"A test covers both","done":true,"at":"2026-10-09T00:26:08.358Z"}]
evidence: [".bytedesk/task-management/evidence/TM-465-1791505568708.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:26:09.170Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:05:49.423Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ ec55c509 (independent review rv-225: merge after F1 console-show receipt leak; F2 handoff self-branch pane proof; F4 wait id oracle)"},{"author":"main","ts":"2026-10-05T17:56:52.170Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ 3350c3f4 (independent final delta review rv-225; follow-ups TM-473 TM-474)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-465-1791505568708.log":{"source":null,"sha256":"e77b4fef20061117e02f86616dee3a0550aac2cc1c24188ab91be19624b030d3","bytes":184,"at":"2026-10-09T00:26:08.709Z"}}
closed: "2026-10-09T00:26:09.164Z"
---

rv-193 on #191 (rule 3): TM-356 bound MCP receive/dispose to the session identity, but orchestration_mailbox_wait (topology-api mailboxWait -> waitForStandingReply ~535) never calls me(); any caller who knows or guesses an id (deterministic review-failed:v2:<nonce>, caller-chosen --id) reads another agent's reply body.