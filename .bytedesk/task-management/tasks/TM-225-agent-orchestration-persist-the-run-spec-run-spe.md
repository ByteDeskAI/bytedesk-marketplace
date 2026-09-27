---
id: "TM-225"
kind: "task"
status: "open"
created: "2026-09-24T21:08:02.493Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: persist the run spec (run_spec) in run.json and the journal"
epic: "EP-021"
acceptance: [{"text":"console control launch with a spec persists run_spec in run.json and a journal event; unit tests","done":false},{"text":"Invalid specs are refused with a clear code; the field name is documented and matches the gateway reader","done":false},{"text":"Launches without a spec behave exactly as before","done":false}]
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
updated: "2026-09-24T22:26:40.115Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:40.110Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): serves gateway TM-444 (EP-027 P0, landed) and TM-448 (P4, parked by Ryan)."}]
---

For gateway EP-027 P0 (TM-444, gateway d387f50e+). The gateway validates a run spec {goal, team, stages, doneCriteria, notifyLevel: silent|milestones|blockers|all, budget, origin: tab|terminal session id} and sends it on console control launch, but the producer ignores it. Store it as run_spec in run.json and emit it in the journal so the gateway reads it back (native run_spec, ACP runSpec - agree one name and document it). Validate the same schema producer-side.