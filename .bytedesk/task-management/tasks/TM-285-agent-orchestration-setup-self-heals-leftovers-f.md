---
id: "TM-285"
kind: "task"
status: "done"
created: "2026-10-02T03:45:44.367Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: setup self-heals leftovers from earlier ao installs and reports stale running sessions"
epic: "EP-023"
acceptance: [{"text":"doctor/ensure lists running ao MCP servers whose build is older than the pointer, by host and pid, with the restart advice; never kills them","done":true,"at":"2026-10-02T13:10:44.852Z"},{"text":"ensure stops leaked agent-orchestration-session-*.scope units whose state root is gone (temp dirs) and hands over from a legacy host/detached nats on the real state root; never touches a scope whose state root exists and is not the managed one (tests with fake systemctl)","done":true,"at":"2026-10-02T13:10:45.255Z"},{"text":"SessionStart warns, with the exact fix, when the current repo enables an ao/bytedesk plugin at project scope (before a commit is blocked)","done":true,"at":"2026-10-02T13:10:45.597Z"},{"text":"doctor flags a TMUX_TMPDIR whose socket path would exceed the unix-socket limit","done":true,"at":"2026-10-02T13:10:45.986Z"}]
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
updated: "2026-10-02T13:10:47.067Z"
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
comments: [{"author":"main","ts":"2026-10-02T04:24:30.416Z","text":"Shipped locally at e2e7fb8d (0.15.0) with TM-284/285/286; live-verified on Linux (see PR). PR opened."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:46.678Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:46.325Z"}}
closed: "2026-10-02T13:10:47.062Z"
---

Problems hit during the 2026-10-01/02 rollout that a fresh developer machine will also hit: (1) long-lived Claude/Codex/Grok sessions keep an old ao MCP server in memory (19 ao MCP processes from builds days old were running); (2) pre-services leftovers: a hand-run or 24h-scope session host, leaked agent-orchestration-session-*.scope units from /tmp clean-install runs, a detached nats-server on the managed JetStream store, old ao-supervise plugin monitors fighting the managed supervisor; (3) a repo whose .claude/settings.json enables an ao/bytedesk plugin at project scope blocks every git commit through guard-project-install.mjs — discovered only at commit time; (4) a TMUX_TMPDIR longer than the unix-socket limit (108 bytes) makes every tmux call fail with 'File name too long'. Fold detection (and safe repair where possible) into the automatic setup and doctor.