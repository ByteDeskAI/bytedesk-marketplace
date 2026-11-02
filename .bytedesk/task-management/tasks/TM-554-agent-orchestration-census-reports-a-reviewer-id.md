---
id: "TM-554"
kind: "task"
status: "open"
created: "2026-11-02T01:09:26.807Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: census reports a reviewer idle while an interactive CLI dialog holds its composer, so review requests fail silently"
epic: "EP-029"
acceptance: [{"text":"census reports needs-input for a pane showing a CLI selection dialog (fixture test)","done":false},{"text":"reviewer status reports unavailable with the dialog reason while the composer is held","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "ae9ea392-cf16-45d0-ac95-824214db0d70"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-02T01:10:29.874Z"
priority: "high"
comments: [{"author":"main","ts":"2026-11-02T01:10:29.866Z","text":"Lead triage (fd2b831f): complements TM-548 (launch-time suppression, wake failure names the dialog, doctor flag). This task owns census/reviewer-status detection. Same live instance here: reviewer c164bf8b pane %171 since ~21:20Z 2026-11-01, blocking reviews of TM-292, TM-523, TM-528."}]
---

Repo: ByteDeskAI/agent-fabric, reviewer bf039c07 (session mass-laptop01--agent-fabric--reviewer--wren), 2026-11-01. After 'reviewer ensure' restarted the reviewer, its Claude pane shows an interactive '/auto-mode-setup' dialog ('You already have auto-mode entries — add to them, or start fresh? 1/2/3, Enter to continue · Esc to cancel'). census --json reports the reviewer state=idle and 'reviewer status' reports available:true, so leads keep queueing reviews. ao-supervisor then fails each request after 5 wake attempts ('the composer is not empty') and posts REVIEW REQUEST FAILED to the lead repeatedly. Expected: census classifies a pane showing a CLI selection dialog as needs-input (not idle); reviewer status reports unavailable with that reason; the supervisor raises one operator alert instead of repeated lead failures. Unknown: what opened /auto-mode-setup in a freshly restarted reviewer — if the restart path or a startup hook typed it, that is a second bug.