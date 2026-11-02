---
id: "TM-348"
kind: "task"
status: "done"
created: "2026-10-05T10:43:43.502Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: manage admit dead-ends on a task with a provisioned worktree but no claim"
epic: "EP-026"
acceptance: [{"text":"admitTask provisions when no claim is held, not only when the worktree is missing; a claim held by another session is still refused","done":true,"at":"2026-10-05T14:02:04.983Z"},{"text":"ownClaim's refusal names the holder session (or none) and the expected owner","done":true,"at":"2026-10-05T14:02:05.349Z"},{"text":"Unit test: task with worktree/branch set, claim null, status open -> admit provisions once and admits; the 'adopted active worker is preserved' test stays green","done":true,"at":"2026-10-05T14:02:05.729Z"},{"text":"Landed on the marketplace default branch and the merge commit reported to d60f0608","done":true,"at":"2026-10-08T23:33:40.946Z"}]
evidence: [".bytedesk/task-management/evidence/TM-400-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/244"]
blockedBy: ["TM-400"]
blocks: ["TM-350","TM-383","TM-393"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T04:15:14.111Z"
links: [{"type":"relates to","id":"TM-360"}]
comments: [{"author":"main","ts":"2026-10-05T12:49:45.486Z","text":"Worker done at b61b096c (tm/TM-347-348-349-rework-admit-base). Lead reran checks: AO test:unit exit 0 (1049 pass/0 fail/4 skip), build:check exit 0, tm unit exit 0 (1603/1603). PR #192 -> fix/ao-local-nats-autostart; independent review running."},{"author":"main","ts":"2026-10-05T12:57:00.130Z","text":"PR #192 review round 1 CHANGES_REQUESTED: provision-when-no-claim let a different session take over a parked task's started record (owner rewrite, stale finish kept). Fix requested: only when no prior record or prior.owner===owner; never for done tasks."},{"author":"main","ts":"2026-10-05T14:02:06.099Z","text":"PR #192 merged into fix/ao-local-nats-autostart at 08fb40048e040ef0071159632d39f3ef6e8a6890 after 3 independent review rounds (record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). Not yet on main: the installed ao-topology runs from the main checkout on main (48e58846). Delivery waits on TM-400 (sync main into the fix branch, then fix -> main)."},{"author":"main","ts":"2026-10-08T23:33:41.835Z","text":"Independent review verdict: approved (PR #192, 3 rounds; https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). Landed on main via PR #221 at 44b030d4."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-400-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-400-landing.md","sha256":"d20428878421a129cc1ef6448861e8579c984a5646e1f081efeb64389588b221","bytes":974,"at":"2026-10-08T23:33:41.374Z"}}
closed: "2026-10-08T23:33:42.252Z"
---

Reported by bytedesk-remote-gateway lead (Dara, d60f0608) 2026-10-05, at Ryan's request; repro gateway TM-500. admitTask (agent-orchestration/topology/lib/management.mjs:377) calls ctx.store.provision only when doc.worktree is unset. A task whose worktree is recorded but whose claim was released (earlier tm worktree new, tm block/park) skips provision, then ownedTask -> ownClaim(null, owner) throws TOPOLOGY_MANAGEMENT_OWNERSHIP 'claim is missing...'. tm worktree new is idempotent (reuses checkout) and refuses a claim held by another session, so provisioning when no claim is held is safe. Out of scope: relaxing the in_progress ownership-review rule.