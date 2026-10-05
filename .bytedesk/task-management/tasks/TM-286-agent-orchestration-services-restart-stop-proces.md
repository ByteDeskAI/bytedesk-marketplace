---
id: "TM-286"
kind: "task"
status: "done"
created: "2026-10-02T03:45:44.905Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: services restart/stop <process> verbs so nobody kills managed processes by name"
epic: "EP-023"
acceptance: [{"text":"services restart <name> restarts exactly that managed process (new pid) via the API; an unknown name is refused","done":true,"at":"2026-10-02T13:10:47.870Z"},{"text":"services status --json lists name, pid, state, restarts for every managed process (test asserts the shape)","done":true,"at":"2026-10-02T13:10:48.236Z"},{"text":"README/skill text tells agents to use these verbs and never pkill/pgrep managed processes","done":true,"at":"2026-10-02T13:10:48.602Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: []
blockedBy: []
blocks: ["TM-288"]
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:10:49.878Z"
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
comments: [{"author":"main","ts":"2026-10-02T04:24:31.142Z","text":"Shipped locally at e2e7fb8d (0.15.0) with TM-284/285/286; live-verified on Linux (see PR). PR opened."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:49.450Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:49.044Z"}}
closed: "2026-10-02T13:10:49.873Z"
---

During live checks a pgrep for 'nats-server -c' matched three unrelated microk8s NATS servers (/etc/nats/nats.conf) alongside the managed one; the kill only failed by luck. Operators and agents need a safe way to act on a managed process: services restart <name> and services stop <name> that go through the process-compose API by process name, and services status --json exposing each process's pid so scripts never pattern-match.