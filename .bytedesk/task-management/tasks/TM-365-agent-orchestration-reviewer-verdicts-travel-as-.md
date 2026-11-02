---
id: "TM-365"
kind: "task"
status: "done"
created: "2026-10-05T10:57:12.349Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: verdicts travel as JSON over mailbox or NATS reply, never screen-scraped"
epic: "EP-028"
acceptance: [{"text":"Reviewer submits a structured verdict through a verb; the lead reads it from the transport","done":true,"at":"2026-10-05T14:15:11.320Z"},{"text":"No code path parses reviewer pane output for a verdict","done":true,"at":"2026-10-05T14:15:11.722Z"},{"text":"Restart does not orphan a submitted verdict","done":true,"at":"2026-10-05T14:15:12.147Z"}]
evidence: [".bytedesk/task-management/evidence/TM-365-1791209712664.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/205","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/251","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/255"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T08:13:26.553Z"
priority: "highest"
links: [{"type":"relates to","id":"TM-347"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-365-1791209712664.log":{"source":null,"sha256":"34e39da4c1d3f56813d0de191915a9d9e50876222d77620e2253683d2bd7c38d","bytes":324,"at":"2026-10-05T14:15:12.666Z"}}
closed: "2026-10-05T14:15:13.122Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:29.749Z","text":"review-sweep: TM-365 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:29:44.943Z","text":"Independent post-merge review verdict on PR #205: changes requested (DEFECTS — HIGH TM-427 forged review submit, HIGH TM-428 worktree attributes hide the patch, MEDIUM-3 folded into TM-428, MEDIUM-4/5 on TM-364). Fixes in progress; the merged code must not be treated as reviewed-approved."}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (C2-1). TOPOLOGY_REVIEWER_RESPONSE is the most common gateway error code. Related TM-216, TM-259, TM-260.