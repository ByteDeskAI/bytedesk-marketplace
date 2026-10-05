---
id: "TM-272"
kind: "task"
status: "blocked"
created: "2026-10-01T17:20:57.490Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: process-compose supervises every standing orchestration process on Linux, macOS and Windows"
epic: "EP-023"
acceptance: [{"text":"services ensure installs a SHA-256-verified pinned process-compose, writes current.json + launcher, renders the project YAML and the OS registration, and is idempotent (second run writes nothing)","done":false},{"text":"killing the session host, NATS, or a supervise process yields a new pid within 5s; killing process-compose is recovered by the OS registration (verified live on Linux)","done":false},{"text":"ensureSessionHost, startRepositorySupervision and ensureLocalNats go through services ensure; the 24h scope remains only behind AGENT_ORCHESTRATION_SERVICES=0; a hand-run session-host exits 0 when a healthy host already owns the state root","done":false},{"text":"the managed session-host runs the recovery sweep: with no MCP session open, a killed worker's run is marked recovery_required","done":false},{"text":"renderers covered by unit tests for linux, darwin and win32 including a repo path with a space and parentheses; fake systemctl/launchctl/schtasks/process-compose record argv","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-human"]
triagedBy: "human"
updated: "2026-10-02T13:11:00.482Z"
comments: [{"author":"main","ts":"2026-10-02T01:04:36.877Z","text":"PR #142 (base fix/ao-local-nats-autostart). Fast-forwarded locally to 28907b1; installed plugin updated to 28907b10ba33; live systemd mode: kill -9 session-host 782032->786489 2.2s, nats 782031->787055 2.2s, supervise 791165->792821 3.3s, process-compose 776255->781998 (systemd NRestarts=1); plugin update repointed current.json and restarted all processes. Not live-verified: macOS, Windows, recovery-without-session (AC4)."},{"author":"@dc778cb2","ts":"2026-10-02T13:11:00.478Z","text":"TM-006 audit (2026-10-02, .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md): PR #142 merged to fix branch. AC1, AC2, AC5 proven; AC4 (managed session-host recovery sweep) has no test or live proof (unit tests use autoRecover:false); AC3 is contradicted by design — the 24h scope is also used when services ensure fails (service.mjs:311-337, supervision.mjs:490). Kept open: prove AC4, and amend AC3 or treat the fallback as a defect."}]
blockedReason: "awaiting human merge of PR #142 (shipped locally at 28907b1)"
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
---

Session host, local NATS and per-repo supervise run under a pinned process-compose that the plugin installs; the OS (systemd user unit / launchd LaunchAgent / Windows Scheduled Task) keeps process-compose alive at login. One idempotent entry: agent-orchestration services ensure. Session host owns the run-recovery sweep (autoRecover) so lost runs recover with no MCP session open. Gateway side is bytedesk-remote-gateway TM-457. Full plan: ~/.claude/plans/woolly-tinkering-possum.md