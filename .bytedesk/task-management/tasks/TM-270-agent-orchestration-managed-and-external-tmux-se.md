---
id: "TM-270"
kind: "task"
status: "open"
created: "2026-10-01T14:08:43.835Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: managed and external tmux sessions get a stable repo-location name (<repo-slug>-<role>)"
epic: "EP-019"
acceptance: [{"text":"A pure function derives the slug from the Git common directory; linked worktrees of one repo yield the same slug","done":false},{"text":"Managed role sessions use <repo-slug>-<role>; a collision is resolved deterministically and tested","done":false},{"text":"Every caller of roleSessionName is updated or shares the one implementation (grep shown in evidence)","done":false}]
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
updated: "2026-10-02T13:11:03.569Z"
comments: [{"author":"@dc778cb2","ts":"2026-10-02T13:11:02.613Z","text":"TM-006 audit: superseded by TM-274 (closed, ADR-0030); roleSessionName removed. Its criteria are not met as written, so tm done refuses. Left open as wontfix-superseded."}]
links: [{"type":"duplicates","id":"TM-274"}]
---

Managed role sessions are named from the agent id; sessions started outside ao-topology keep random names. Name them <repo-slug>-<role> (e.g. bytedesk-marketplace-lead). Slug derives from the Git common directory so linked worktrees share it. Requested by Ryan via the gateway-repo session.