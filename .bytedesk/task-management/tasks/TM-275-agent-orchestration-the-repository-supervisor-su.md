---
id: "TM-275"
kind: "task"
status: "open"
created: "2026-10-02T00:58:08.513Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the repository supervisor survives a NATS JetStream timeout instead of exiting"
epic: "EP-023"
acceptance: [{"text":"A JetStream request timeout in the supervisor loop is caught, logged visibly, and retried with backoff; the process stays alive","done":false},{"text":"A test injects a NatsError TIMEOUT and shows the supervisor still ensures the lead on the next tick","done":false},{"text":"Every other uncaught NATS call on the supervisor path is covered or shown unreachable (grep in evidence)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "81e61d16-ae0f-495c-a2a4-7148fc8fa898"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["wontfix"]
triagedBy: "human"
updated: "2026-10-02T13:11:02.165Z"
comments: [{"author":"@dc778cb2","ts":"2026-10-02T13:11:01.221Z","text":"TM-006 audit: duplicate of TM-277 (closed). AC1/AC2 proven by TM-277's tests; AC3 (grep for other uncaught NATS calls) has no evidence, so tm done would refuse. Left open as wontfix-duplicate pending a grep or an override."}]
links: [{"type":"duplicates","id":"TM-277"}]
---

Gateway repo supervisor Monitor exited 1 on an uncaught NatsError: TIMEOUT from a JetStreamManager request (nats jsbaseclient_api via NatsConnectionImpl.request). While down, nothing ensures the lead or resumes held mail, breaking the every-repo-has-a-lead guarantee. Catch the timeout, retry with backoff, keep running, log a visible error. Related gateway task TM-457. Requested by Ryan via the gateway-repo session.