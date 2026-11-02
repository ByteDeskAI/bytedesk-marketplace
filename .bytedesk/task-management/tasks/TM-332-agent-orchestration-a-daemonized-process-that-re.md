---
id: "TM-332"
kind: "task"
status: "open"
created: "2026-10-04T00:58:17.983Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a daemonized process that reparents out of a pane tree is treated as the operator by the credential holder"
epic: "EP-026"
acceptance: [{"text":"A daemonized child of an agent pane is refused by the admin socket and the agent holders (test with a real double-fork, printed refusal)","done":false},{"text":"Legitimate operator CLIs (launch, failover, revoke) still work","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T01:49:30.802Z"
comments: [{"author":"main","ts":"2026-10-04T01:49:30.798Z","text":"Mitigation (lineage markers + positive operator proof, five real-process escapes stopped) is on nats/hardening, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/180. Narrowed, not closed: a process that scrubs its environment, calls setsid and execs the node binary still gets the seed (asserted in a test). Left open."}]
---

Found by reading the code in TM-316 (not run). peerPids/isDescendant judge 'operator' as 'outside every agent tree'; a same-uid process that double-forks to pid 1 is outside every tree and can ask the admin socket for the seed. Needs a positive operator proof (for example a per-session secret handed only to the operator's own terminal process, or running panes in a pid namespace) instead of absence from the roots registry. See agent-orchestration/docs/adr/0003-same-uid-threat-model.md.