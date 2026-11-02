---
id: "TM-402"
kind: "task"
status: "open"
created: "2026-10-05T13:05:29.766Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead.mjs wakeLead rings without withServer(binding.serverKey), possibly the default tmux server"
epic: "EP-028"
acceptance: [{"text":"A test proves wakeLead targets the binding's tmux server (record which server the ring addressed)","done":false},{"text":"wakeLead and the held-mail ring share one helper","done":false}]
evidence: []
commits: ["f74bdffd"]
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T03:13:28.109Z"
comments: [{"author":"main","ts":"2026-10-09T01:36:35.190Z","text":"Implemented inside the TM-478 governed worker (probe/ring path), 2026-10-09."},{"author":"@main","ts":"2026-10-09T03:13:28.101Z","text":"Implemented in TM-478 PR #242 (4f366ec): ringLeadPane is the one ring helper for wakeLead and the held-mail ring, run inside withServer(binding.serverKey); test 'the lead ring addresses the binding's tmux server' records argv '-S <serverKey> display-message ...'. Close with TM-478 after it lands."}]
---

Spotted by the TM-384 worker 2026-10-05: wakeLead in agent-orchestration/topology/lib/lead.mjs calls wakeForProbe without wrapping it in withServer(binding.serverKey), unlike goal-loop-notify.mjs and TM-384's held-mail ring. If the lead's pane lives on a non-default tmux server the probe ring goes to the wrong server, which would explain probes that never land. Verify, then fix by sharing one ring helper.