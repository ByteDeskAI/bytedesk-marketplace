---
id: "TM-279"
kind: "task"
status: "done"
created: "2026-10-02T02:20:50.136Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: team-scoped persona registry on NATS KV (ADR-0030 part 3)"
epic: "EP-023"
acceptance: [{"text":"two nodes allocating concurrently in one team never receive the same persona (integration test with two allocators against one nats-server with JetStream)","done":true,"at":"2026-10-02T13:10:35.482Z"},{"text":"a persona is released when its session ends and a dead holder is reclaimed after the presence timeout, without freeing a live holder","done":true,"at":"2026-10-02T13:10:35.929Z"},{"text":"with NATS unreachable, team-scoped allocation fails with a clear error and solo/repo scope keeps working from the local registry","done":true,"at":"2026-10-02T13:10:36.358Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: ["ADR-0030"]
blockedBy: ["TM-274"]
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:10:38.106Z"
comments: [{"author":"main","ts":"2026-10-02T03:57:49.531Z","text":"Shipped locally at 4472a744 (0.14.0) with TM-27280; PR opened. Suite 911/907/0/4."},{"author":"main","ts":"2026-10-02T03:58:02.970Z","text":"Correction to previous comment: shipped together with TM-280 as 0.14.0 (4472a744), PR #148."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:37.458Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:36.766Z"}}
closed: "2026-10-02T13:10:37.900Z"
---

Implements the team half of ADR-0030 part 3 behind the registry interface TM-274 introduces. Persona names are unique per team across all nodes: allocation is an atomic KV create (revision-checked) in a team bucket keyed by persona, holding the session ULID, node and repo; released when the session ends; stale holders reclaimed via presence/heartbeat. Solo/offline falls back to the local file-lock registry. Leaf-node aware: works when nodes reach the team bucket through NATS leaf connections.