---
id: "TM-250"
kind: "task"
status: "open"
created: "2026-09-25T18:03:21.321Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: cutover and release verbs wrap deploy-safe and /release behind guardrails"
epic: "EP-024"
acceptance: [{"text":"manage cutover wraps deploy-safe: develop only, synced with origin, all planned tasks landed; it proves the running binary switched and refuses otherwise.","done":false},{"text":"manage release wraps /release: develop to release/*, all planned tasks landed, and verifies the published result.","done":false},{"text":"Leads never run systemctl or push directly; tests cover each refusal.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-253"]
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-02T05:15:41.693Z"
comments: [{"author":"main","ts":"2026-09-25T20:27:30.492Z","text":"Released from hold: Ryan approved lead autonomy directly in the marketplace lead's session on 2026-09-25 ('Approve all'). Decision recorded as ADR-0022. Still waits on TM-234."},{"author":"main","ts":"2026-10-02T05:15:02.199Z","text":"TM-288 board review (approved by Ryan 2026-10-02): stale blocked-by link(s) to done task(s) removed (report §8)."}]
---

Plan from gateway lead d60f0608, 2026-09-25, reported as approved by Ryan in that session ('Approve as written') with the operating model: 'All I should be involved in is the planning and approving plans. team leads should drive the completion and approvals after planning until it is released and cleaned up.' This changes ADR-0001 (merge is PR-level; branch delete is repo-destructive and deploy is external, both always human) and the 'humans merge' rule, so it is held for Ryan's confirmation in the marketplace lead's session and a recorded decision. Part (b), cutover and release. These are External-class actions under ADR-0001 today.