---
id: "TM-316"
kind: "task"
status: "open"
created: "2026-10-03T04:06:53.440Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: same-uid agent can rewrite nats-server.conf and SIGHUP, or daemonize past the tree check"
epic: "EP-026"
acceptance: [{"text":"A same-uid agent cannot alter the server config or reload it, proven by a printed refusal","done":false},{"text":"Documented threat model states what remains","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/180"]
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T00:58:17.034Z"
comments: [{"author":"main","ts":"2026-10-04T00:58:17.029Z","text":"Tamper detection and repair plus the threat-model ADR are on branch nats/hardening, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/180 (stacked on #179). Not closed: a same-uid process can still kill the admin holder or the server; real isolation needs a separate uid or the provider sandbox."}]
---

TM-310 residual. Closing it needs a separate uid or the provider sandbox (TM-282), or gateway-issued creds only. Issue, revoke and reload are still file-and-signal operations.