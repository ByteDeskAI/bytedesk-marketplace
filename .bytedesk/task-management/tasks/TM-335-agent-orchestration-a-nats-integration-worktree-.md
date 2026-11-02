---
id: "TM-335"
kind: "task"
status: "open"
created: "2026-10-04T05:07:27.094Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a nats/integration worktree process rewrote the live NATS state to schema 2, locking out main's shared-credential clients"
epic: "EP-026"
acceptance: [{"text":"A worktree or unmerged build cannot write the live NATS home; it uses its own AO NATS home, with a test","done":false},{"text":"main's client refuses a schema 2 state.json with a named error instead of Authorization Violation","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "81e61d16-ae0f-495c-a2a4-7148fc8fa898"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T05:15:02.978Z"
comments: [{"author":"main","ts":"2026-10-04T05:15:02.973Z","text":"Decision (Ryan, 2026-10-04, ADR-0039): adopt the per-agent credential scheme. Resolved by landing PR #179 (nats/integration); remaining work here is the guard against an unmerged worktree build writing the live NATS home."}]
---

On 2026-10-04 main's ao-topology could not read any mailbox: Authorization Violation. Cause: credential-holder, supervise and launch processes running from .claude/worktrees/nats-integ (branch nats/integration, per-agent credentials) share ~/.bytedesk/agent-orchestration/nats with main code. state.json became schema 2 (adminPub, no user or pass) and the server logs authentication error for user ao-orch; main nats-local.mjs reads state.user and state.pass. Worktree builds must not touch the live NATS home, and either the scheme is merged or the state dir is separated. Workaround used: run the nats/integration cli.mjs. Related TM-276, TM-308.