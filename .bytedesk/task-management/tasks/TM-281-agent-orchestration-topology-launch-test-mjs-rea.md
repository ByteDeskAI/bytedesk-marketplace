---
id: "TM-281"
kind: "task"
status: "done"
created: "2026-10-02T02:22:24.024Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-launch.test.mjs real-tmux tests run on the operator's default tmux server"
epic: "EP-023"
acceptance: [{"text":"every real-tmux test in tests/ sets TMUX='', a per-test TMUX_TMPDIR, and scopes every kill-server/kill-session with -S or -L (grep proves no bare kill-server/kill-session remains in tests/)","done":true,"at":"2026-10-02T13:10:29.720Z"},{"text":"a shared test helper refuses (fails the test) when the tmux socket it would use is the operator's default socket; a test proves the refusal","done":true,"at":"2026-10-02T13:10:30.116Z"}]
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
updated: "2026-10-02T13:10:31.377Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-02T03:32:27.944Z","text":"PR (0.13.1, base #144). Fast-forwarded locally to 60a33288; installed plugin 60a3328828f4. Suite with only TMUX= set: 884/880/0/4; default tmux server 15 session names identical before/after."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:30.923Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:30.473Z"}}
closed: "2026-10-02T13:10:31.372Z"
---

Found by the TM-274 worker (2026-10-02): the real-tmux cases in tests/unit/topology-launch.test.mjs set only TMUX='' — no per-test TMUX_TMPDIR and no -S/-L on kill-server/kill-session — so with a plain `TMUX= npm run test:unit` they create and kill sessions on the operator's default tmux server, where live agent sessions run. This is the exact hazard of INCIDENT-2026-09-09 (37 sessions destroyed). Workaround until fixed: run the suite with TMUX_TMPDIR pointed at a scratch dir. Fix per .claude/rules/tmux-test-isolation.md (all three rules), and add a guard so the suite refuses to run real-tmux tests unless the socket is isolated.