---
id: "TM-226"
kind: "task"
status: "open"
created: "2026-09-24T21:08:02.665Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: every run ends in awaiting_approval with needs-you reason approval"
epic: "EP-021"
acceptance: [{"text":"A run that finishes its stages enters awaiting_approval and records reason approval in run.json and the journal; unit tests","done":false},{"text":"No cleanup of worktrees, branches or agent sessions happens while a run is awaiting_approval; test","done":false},{"text":"failed/stopped runs keep their existing states","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-227"]
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:26:40.275Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:40.269Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): serves gateway TM-444 (EP-027 P0, landed) and TM-448 (P4, parked by Ryan)."}]
---

For gateway EP-027 P0 (TM-444). Ryan's decision: every run, whatever its notify level, ends waiting for his approval of the final product; only after approval does it merge and clean up. The producer never emits awaiting_approval today. Add the terminal state, the needs-you reason approval, and make no run auto-clean its worktrees/branches/sessions before approval.