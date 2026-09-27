---
id: "TM-229"
kind: "task"
status: "blocked"
created: "2026-09-24T21:08:03.198Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: promote an existing terminal session to lead of a new run"
epic: "EP-021"
acceptance: [{"text":"launch with an adopt-lead binding records the existing session as lead and starts the team; unit tests with a fake pane","done":false},{"text":"Adopted sessions are never closed by run cleanup; test","done":false},{"text":"Refuses bindings that are dead, reused or already leading another run","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:26:41.435Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:40.769Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): serves gateway TM-445 (EP-027 P1, parked by Ryan)."}]
blockedReason: "Serves a gateway EP-027 phase Ryan parked (relayed by gateway lead d60f0608 on 2026-09-24). Held here so the pool does not dispatch it. Unblock when Ryan un-parks that phase."
---

For gateway EP-027 P1 (TM-445): 'Promote to orchestration' opens the planner seeded with a terminal session's context and that session becomes the run's lead. The producer needs a launch mode that adopts an existing live session (verified binding: server, pane, pid, start time) as lead instead of spawning one, without restarting it, and records ownership so cleanup never kills a session it did not start.