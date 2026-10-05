---
id: "TM-333"
kind: "task"
status: "open"
created: "2026-10-04T00:58:18.534Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: run topology panes under the provider sandbox with the NATS home unmounted"
epic: "EP-026"
acceptance: [{"text":"A pane started under the sandbox cannot see or write the NATS home, and can still reach its own holder socket","done":false},{"text":"Works on the CI runner image or the limitation is documented","done":false}]
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
updated: "2026-10-04T00:58:18.542Z"
---

ADR-0003 plan: bwrap sandbox for panes with a pid namespace and the NATS home and holder sockets not mounted. Blockers listed in the ADR include loopback networking inside the sandbox (bwrap: loopback: Failed RTM_NEWADDR on the CI runner) and the holder's peer check across pid namespaces.