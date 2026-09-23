---
id: "TM-209"
kind: "task"
status: "open"
created: "2026-09-23T22:21:27.766Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: 'lead status' always probes and can block 30s; add a non-blocking read"
epic: "EP-019"
acceptance: [{"text":"'ao-topology lead status --cached' (or an equivalent documented default) returns in under 1s and writes no probe file.","done":false},{"text":"The output includes proof_age_ms and the source of the verdict (cached, late, fresh probe).","done":false},{"text":"The blocking behaviour that remains is documented in the CLI help, and a test asserts no probe file is created by the cached path.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-23T22:21:44.003Z"
---

topology/cli.mjs:486 calls leadState without a timeout, so it uses DEFAULT_ACK_TIMEOUT_MS 30000 (lead.mjs:58, 302) and, with no stored proof, polls to the deadline (lead.mjs:164-173). The readOnly flag added in 570a6bb is never passed by the CLI. The observer measured its own poll loop stretching from 62s to 97s per cycle because of this, and each status call also mints a probe that can ring the lead's pane.