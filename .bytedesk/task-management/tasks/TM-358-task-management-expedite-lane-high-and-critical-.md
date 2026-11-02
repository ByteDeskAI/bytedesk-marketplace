---
id: "TM-358"
kind: "task"
status: "done"
created: "2026-10-05T10:57:06.191Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: expedite lane - high and critical tasks dispatch immediately outside poolWip"
epic: "EP-028"
acceptance: [{"text":"A critical ready task dispatches on the next tick even when poolWip is full","done":true,"at":"2026-10-05T14:14:50.547Z"},{"text":"expediteWip caps concurrent expedited workers","done":true,"at":"2026-10-05T14:14:50.926Z"},{"text":"Normal-priority behaviour is unchanged (test)","done":true,"at":"2026-10-05T14:14:51.320Z"}]
evidence: [".bytedesk/task-management/evidence/TM-358-1791209691744.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/199","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:35:00.429Z"
priority: "highest"
evidenceSources: {".bytedesk/task-management/evidence/TM-358-1791209691744.log":{"source":null,"sha256":"ca89439e87f3b507c0b75cfb285592cb941f306831912e9fcd155727ad07074c","bytes":324,"at":"2026-10-05T14:14:51.745Z"}}
closed: "2026-10-05T14:14:52.215Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:27.999Z","text":"review-sweep: TM-358 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:35:00.425Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/199 (independent post-merge review rv-203; TM-358 and TM-363 criteria met; TM-362 fixes TM-439 TM-440)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (B3). New dispatch.expediteWip (default 2); bypass poll wait and touches-disjoint batching; always a worktree.