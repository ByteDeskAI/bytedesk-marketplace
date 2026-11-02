---
id: "TM-250"
kind: "task"
status: "done"
created: "2026-09-25T18:03:21.321Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: cutover and release verbs wrap deploy-safe and /release behind guardrails"
epic: "EP-028"
acceptance: [{"text":"manage cutover wraps deploy-safe: develop only, synced with origin, all planned tasks landed; it proves the running binary switched and refuses otherwise.","done":true,"at":"2026-10-05T15:27:00.429Z"},{"text":"manage release wraps /release: develop to release/*, all planned tasks landed, and verifies the published result.","done":true,"at":"2026-10-05T15:27:00.985Z"},{"text":"Leads never run systemctl or push directly; tests cover each refusal.","done":true,"at":"2026-10-05T15:27:01.546Z"}]
evidence: [".bytedesk/task-management/evidence/TM-250-1791214022185.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/213","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: ["TM-253","TM-368"]
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-05T15:50:21.894Z"
comments: [{"author":"main","ts":"2026-09-25T20:27:30.492Z","text":"Released from hold: Ryan approved lead autonomy directly in the marketplace lead's session on 2026-09-25 ('Approve all'). Decision recorded as ADR-0022. Still waits on TM-234."},{"author":"main","ts":"2026-10-02T05:15:02.199Z","text":"TM-288 board review (approved by Ryan 2026-10-02): stale blocked-by link(s) to done task(s) removed (report §8)."},{"author":"main","ts":"2026-10-05T15:50:21.888Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/213 (independent post-merge review rv-gov: fixes TM-457 TM-458, TM-442)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-250-1791214022185.log":{"source":null,"sha256":"88b70c8e3abe611c217f1e18f94f8562a3aa466e61245d3143e5685c25ae48f0","bytes":368,"at":"2026-10-05T15:27:02.187Z"}}
closed: "2026-10-05T15:27:02.851Z"
---

Plan from gateway lead d60f0608, 2026-09-25, reported as approved by Ryan in that session ('Approve as written') with the operating model: 'All I should be involved in is the planning and approving plans. team leads should drive the completion and approvals after planning until it is released and cleaned up.' This changes ADR-0001 (merge is PR-level; branch delete is repo-destructive and deploy is external, both always human) and the 'humans merge' rule, so it is held for Ryan's confirmation in the marketplace lead's session and a recorded decision. Part (b), cutover and release. These are External-class actions under ADR-0001 today.