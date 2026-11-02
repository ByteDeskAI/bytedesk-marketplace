---
id: "TM-508"
kind: "task"
status: "open"
created: "2026-10-09T04:28:57.337Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY agent-orchestration: a governed worker running as the same user can write the review records and reviewer binding the merge gate trusts"
epic: "EP-026"
acceptance: [{"text":"A dispatched governed worker cannot create or modify any file under the AO state root that the merge gate or reviewer identity reads (test proves the write is refused)","done":false},{"text":"A dispatched worker cannot read any secret used to authenticate review records","done":false},{"text":"The legitimate reviewer and lead paths still work on a live pane","done":false}]
evidence: []
commits: []
blockedBy: ["TM-427"]
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T17:17:54.559Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-09T09:49:13.122Z","text":"Two identity follow-ups from review-235 (TM-427 delta, 2026-10-09): (1) MINOR: requireBoundAgentCaller (delegation.mjs:272) walks process ancestry without first checking the bound pane is live, unlike requireReviewerCaller. A stale census row plus pane-pid reuse could let an unrelated process pass as that agent for mail. Fix: a listPanes liveness check before the walk. (2) Pre-existing, out of TM-427's scope: management.mjs:1358 transferTask takes the caller's name from TM_SESSION_ID or AO_AGENT_ID, and 'take over for itself' is allowed for any unproven name. Needs requireBoundAgentCaller or requireLeadCaller."}]
---

Found by the lead security review of PR #235 (TM-427), 2026-10-09. Every input the merge gate reads is plain JSON under the AO state root, owned by the same user as every worker: reviews/<task>/<rev>.json, the request file's collected_at, the reviewer record <key>.json (including its pane binding, which requireReviewerCaller trusts), management/<repo>/TM-n.json, and the inbox verdicts. A worker with a shell can write an approve record directly, or rebind the reviewer record to its own pane. An HMAC key in the same state root does not help, because the worker can read it or plant it. Pane proof (TM-427) is only sound if workers cannot write AO state. Fix direction: run dispatched workers with no write access (and no read access to secrets) under the AO state root, using the existing provider sandbox (bubblewrap; Seatbelt on darwin, TM-282), or hold the gate's inputs in a process or user the worker cannot reach. Related: TM-310, TM-316, TM-489.