---
id: "TM-277"
kind: "task"
status: "done"
created: "2026-10-02T01:04:37.299Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: ao-topology supervise crashes on a NATS JetStream request TIMEOUT instead of reconnecting"
epic: "EP-023"
acceptance: [{"text":"with the supervisor running, restarting nats-server does not end the supervisor process (same pid before and after)","done":true,"at":"2026-10-02T13:10:23.094Z"},{"text":"a unit test injects a JetStream TIMEOUT into one tick and asserts the loop continues","done":true,"at":"2026-10-02T13:10:23.498Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:11:01.846Z"
comments: [{"author":"main","ts":"2026-10-02T02:30:29.456Z","text":"PR #143 (with TM-273, 0.12.1). Fast-forwarded locally to 737b728e; installed plugin 737b728e8e9b. Live: kill -9 managed nats-server 2772774 -> 2779470; supervisors 2775864/2775137/2774218 unchanged. Suite (isolated tmux): 868/864/0/4."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:24.280Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:23.886Z"}}
closed: "2026-10-02T13:10:24.698Z"
links: [{"type":"duplicated by","id":"TM-275"}]
---

Observed 2026-10-01 during TM-272 live checks: killing the managed nats-server made the repository supervisor exit 1 with an unhandled NatsError code TIMEOUT from JetStreamManagerImpl._request (node_modules/nats/lib/jetstream/jsbaseclient_api.js). Under process-compose it is restarted in ~3s, but a supervisor should survive a NATS restart: catch transport errors in the tick, back off, and reconnect.