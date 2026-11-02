---
id: "TM-494"
kind: "task"
status: "open"
created: "2026-10-09T01:47:24.783Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a repository with several reviewer definitions crash-loops its supervisor"
epic: "EP-028"
acceptance: [{"text":"The supervisor keeps running when several reviewer definitions exist: it reports the ambiguity (doctor + one lead notice) and skips only reviewer presence","done":false},{"text":"A documented verb retires the extra reviewer definitions, keeping the registered/live one","done":false},{"text":"Test with three reviewer definitions: the tick completes","done":false},{"text":"ao-topology agent retire <id> moves a non-live agent definition out of the library (refused for a live or registered agent); the supervisor recovers on its next tick","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["wontfix"]
triagedBy: "human"
updated: "2026-10-09T01:48:25.801Z"
comments: [{"author":"main","ts":"2026-10-09T01:48:09.496Z","text":"agent-browser lead (Ines) identified the extras: Cleo Duvall b58195de, Hana Thorne cf74f195, Tovi Duvall fbccd0d0 (no live session); Juno a076d527 is the registered reviewer. Moving them by hand was denied by that session's classifier; Ryan to approve the manual cleanup, or this verb lands first."},{"author":"main","ts":"2026-10-09T01:48:25.791Z","text":"Closed as duplicate of TM-495 (marketplace lead owns it: it touches reviewer ensure in reviewer.mjs)."}]
links: [{"type":"duplicates","id":"TM-495"}]
---

Observed 2026-10-08: supervise-5cef2378f8a90e38 (bytedesk-agent-browser) restarting 175+ times, dead since 2026-10-05T09:08 with TOPOLOGY_PRESENCE_MULTIPLE_STANDING: Multiple repository reviewer definitions; refusing ambiguous presence. Cause: the pre-TM-364 reviewer ensure created several Claude reviewers (Emil, Sable, Juno) in that repo. TM-364 stops new duplicates but nothing repairs existing ones, and one ambiguity kills the whole supervisor instead of degrading presence.