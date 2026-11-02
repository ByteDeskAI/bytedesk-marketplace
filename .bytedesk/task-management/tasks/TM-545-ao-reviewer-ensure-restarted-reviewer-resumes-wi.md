---
id: "TM-545"
kind: "task"
status: "open"
created: "2026-11-01T21:03:51.432Z"
board: "bytedeskai/bytedesk-marketplace"
title: "ao reviewer ensure: restarted reviewer resumes with a stale composer draft and an auto-mode dialog, so every review wake fails"
epic: "EP-029"
acceptance: []
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "08673d50-605e-4443-a4a9-6605ef3dff96"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["needs-triage"]
triagedBy: "auto"
triageMissing: ["body","acceptance criteria"]
updated: "2026-11-01T21:04:01.250Z"
comments: [{"author":"main","ts":"2026-11-01T21:04:00.874Z","text":"Reported by infrastructure lead aad9e97d, 2026-11-01. Repo: ByteDeskAI/infrastructure (develop). Steps: the reviewer session mass-laptop01--infrastructure--reviewer--maeve (agent a2cefe9d) died (pane exit 143 at 15:50 EST). 'ao-topology reviewer ensure --consumer /home/ryan/Documents/GitHub/ByteDeskAI/infrastructure --provider claude' returned restarted:true and 'reviewer status' then said available:true. But the relaunched Claude Code pane (%83) shows (a) the previous session's unsent composer draft 'check the inbox again' restored into the input box and (b) the Claude Code 'Teach auto mode about your environment?' Yes/Not now dialog. ao-supervisor then reported: 'REVIEW REQUEST FAILED: TM-026 at fedf126a ... could not be delivered to the reviewer after 5 wake attempts (the composer is not empty).' Conflict: reviewer status says available while the wake gate refuses every delivery. Expected: ensure/restart starts with an empty composer and no blocking first-run dialog, or reviewer status reports unavailable with that reason. Workaround: operator clears the pane by hand."}]
priority: "high"
---

