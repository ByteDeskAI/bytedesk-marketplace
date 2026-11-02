---
id: "TM-546"
kind: "task"
status: "in_progress"
created: "2026-11-01T21:05:54.403Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: refuse a second reviewer definition (supervisor crash loop on TOPOLOGY_PRESENCE_MULTIPLE_STANDING)"
epic: "EP-019"
acceptance: [{"text":"createAgent refuses a second reviewer in a repository with a typed error, as it does for a second lead","done":false},{"text":"ensureReviewer never mints a second reviewer when a stopped reviewer exists on another provider","done":false},{"text":"Unit tests cover both and the topology suite passes","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "6788339e-b128-40a1-ab0d-7e16c58670e9"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:06:15.715Z"
touches: ["Documents/GitHub/ByteDeskAI/bm-tm546/agent-orchestration/topology/lib/agents.mjs"]
---

## Problem

A repository can end up with more than one reviewer definition under
`.bytedesk/agent-orchestration/agents/`. The presence loader (`topology/lib/presence.mjs` `loadLibrary`)
then refuses with `TOPOLOGY_PRESENCE_MULTIPLE_STANDING: Multiple repository reviewer definitions;
refusing ambiguous presence.`, and the repository supervisor exits on every start.

Seen live on 2026-11-01: `bytedesk-agent-browser` had four reviewers created within 3 minutes on
2026-10-05 (a076d527 claude, b58195de / cf74f195 / fbccd0d0 codex). Its process-compose supervisor
`supervise-5cef2378f8a90e38` restarted ~549,600 times. Workaround applied: the three that never ran
were moved to `~/.local/state/bytedesk/agent-orchestration/retired-agents/bytedesk-agent-browser/`.

## Cause

`createAgent` (`topology/lib/agents.mjs`) refuses a second lead (`TOPOLOGY_LEAD_EXISTS`) but has no
matching check for reviewers, although presence treats both as singletons. Every path that mints a
reviewer goes through `createAgent`: `agent new --role reviewer`, `role assign reviewer`, and
`ensureReviewer`, which mints a new reviewer whenever no existing one matches the requested provider
(`library.find(a => a.cli === provider)`), so a stopped claude reviewer plus `--provider codex`
produces a second reviewer.

## Fix

Refuse a second reviewer in `createAgent`, the one place agents are registered, the same way a second
lead is refused. `ensureReviewer` reuses a stopped reviewer on another provider rather than minting.
