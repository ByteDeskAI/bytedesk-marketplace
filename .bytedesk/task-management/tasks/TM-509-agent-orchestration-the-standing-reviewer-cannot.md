---
id: "TM-509"
kind: "task"
status: "blocked"
created: "2026-10-09T04:31:59.984Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the standing reviewer cannot read standing mail (no shell, and the mailbox is outside its file-tool paths), and a blocked verdict deadlocks rework"
epic: "EP-029"
acceptance: [{"text":"The standing reviewer can read standing mail addressed to it (an MCP tool, or delivery into its review inbox)","done":false},{"text":"A blocked review of a finish revision has a supported lead path back to a working round (rework from blocked, or retry once checks are fixed), with a test","done":false}]
evidence: []
commits: []
blockedBy: ["TM-515","TM-518"]
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:20:13.187Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T05:06:27.910Z","text":"Another deadlock shape (2026-10-09, TM-485): the last worker was collected as failed, so tm has no submitted revision. 'manage rework' then crashed with an uncaught Node exception and a raw stack trace: 'tm rework: TM-485: only the revision submitted for review (none) can return to work'. It should refuse with a TOPOLOGY_* error that names the recovery step (manage admit resumes the admission, then start-worker)."}]
---

Seen 2026-10-09 with faro (c164bf8b, marketplace reviewer). (1) Three standing messages from the lead (faro-queue-2026-10-09a, faro-queue-2026-10-09b, faro-235-context) were delivered and rung, but faro cannot read them: reading needs 'ao-topology mailbox inbox', the reviewer has no Bash, and the standing mailbox is outside its allowed file paths. The lead had to paste into its tmux pane. (2) Faro submitted 'blocked' verdicts on TM-478, TM-484, TM-427 and TM-412, citing required-check timeouts from the old unit argv (fixed on main by #239). With a blocked verdict and the worker exited: 'manage rework' refuses (TOPOLOGY_MANAGEMENT_REWORK_REVIEW needs changes_requested), and 'manage start-worker' refuses (TM_GOVERNED_ADMISSION_REQUIRED, ownership or working state mismatch). No lead verb moves the task forward. Related: TM-488 (a lead-commissioned review cannot drive rework).