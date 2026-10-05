---
id: "TM-271"
kind: "task"
status: "open"
created: "2026-10-01T14:08:47.620Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: send and mailbox send can address a repository's lead by repo path or slug"
epic: "EP-019"
acceptance: [{"text":"The to-repo option accepts a repo path or slug and delivers to that repo's registered lead","done":false},{"text":"An unknown repo or a repo with no lead refuses with the reason, exit non-zero, nothing delivered","done":false},{"text":"send and mailbox send share one resolver, with a test through each CLI entry","done":false}]
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
updated: "2026-10-02T05:15:48.025Z"
---

Today a message needs the recipient agent id. Add a to-repo option to send and mailbox send that resolves to the repo's registered lead. Requested by Ryan via the gateway-repo session.