---
id: "TM-292"
kind: "task"
status: "in_progress"
created: "2026-10-02T13:09:10.590Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management dispatch: a claude -p worker that backgrounds a long command and ends its turn exits mid-task"
epic: "EP-019"
acceptance: [{"text":"the dispatch handoff tells a print-mode worker to run commands in the foreground and not end its turn until it has committed and reported, or blocked","done":false},{"text":"an exit with no finish report, no block and a dirty worktree is recorded as 'exited mid-task' (not a normal exit), naming the last assistant message; unit test","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@pool"
session: "fd2b831f"
branch: "tm/TM-292-task-management-dispatch-a-claude-p-worker-that-"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-292-task-management-dispatch-a-claude-p-worker-that-"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T20:58:18.807Z"
links: [{"type":"relates to","id":"TM-247"}]
comments: [{"author":"@dc778cb2","ts":"2026-10-02T13:40:17.110Z","text":"QUEUED NEXT (operator decision 2026-10-02): dispatched by the Bastion lead as soon as marketplace WIP (12/12) has room. Its touches are disjoint from the TM-247 slice."},{"author":"@dc778cb2","ts":"2026-10-02T13:40:45.240Z","text":"Touches note: 'task-management/lib/handoff.mjs' and '-task-management/lib/handoff.mjs' were added by mistake (no such file; the handoff renderer is task-management/lib/render.mjs). tm touches has no removal syntax, so they stay; they match nothing."},{"author":"main","ts":"2026-11-01T20:54:22.967Z","text":"{\"event\":\"start\",\"at\":\"2026-11-01T20:54:22.781Z\",\"owner\":\"fd2b831f\",\"worktree\":\"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-292-task-management-dispatch-a-claude-p-worker-that-\",\"branch\":\"tm/TM-292-task-management-dispatch-a-claude-p-worker-that-\",\"base_revision\":\"8189a6bd34faf7bcb0885492301c2d12078b3c8a\",\"base_source\":\"server-tip\",\"intent\":\"Implement TM-292 to its acceptance criteria: task-management dispatch: a claude -p worker that backgrounds a long command and ends its turn exits mid-task\",\"boundaries\":[\"-task-management/lib/handoff.mjs\",\"task-management/lib/dispatch/tmux.mjs\",\"task-management/lib/handoff.mjs\",\"task-management/lib/render.mjs\",\"task-management/tests/unit\"],\"dependencies\":[],\"checks\":[\"agent-orchestration: npm ci\",\"agent-orchestration: unit\",\"agent-orchestration: build:check\",\"task-management: unit\",\"agent-orchestration: plugin validate\",\"task-management: plugin validate\",\"plugin-rsync: tests\"],\"files\":[\"-task-management/lib/handoff.mjs\",\"task-management/lib/dispatch/tmux.mjs\",\"task-management/lib/handoff.mjs\",\"task-management/lib/render.mjs\",\"task-management/tests/unit\"]}"}]
priority: "high"
touches: ["-task-management/lib/handoff.mjs","task-management/lib/dispatch/tmux.mjs","task-management/lib/handoff.mjs","task-management/lib/render.mjs","task-management/tests/unit","task-management/tests/unit/result.test.mjs","task-management/tests/unit/subagent-brief.test.mjs"]
governance: {"version":1,"runtime":"topology","workflowRunId":"tm-TM-292","leadId":"fd2b831f","recordPath":"/home/ryan/.local/state/bytedesk/agent-orchestration/management/8890762dbb279261/TM-292.json","state":"working"}
integrationBranch: "main"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-292","session":"fd2b831f","at":"2026-11-01T20:54:32.078Z","anchors":[{"pid":2678942,"start":"241380527"}]}
---

Observed 2026-10-02 on marketplace TM-276 and TM-287 (dispatched by Bastion lead dc778cb2 through manage start-worker, tmux backend). The tmux backend runs DEFAULT_COMMAND claude -p --dangerously-skip-permissions (task-management/lib/dispatch/tmux.mjs:39). In print mode the process exits when the model ends its turn. TM-276's worker started the full unit suite with run_in_background, wrote 'Full unit suite is still running. Once it finishes, I'll commit, push and open the PR.', and ended its turn: claude exited, the pane closed, the suite was orphaned, and tm collect recorded 'worker exited without closing' with uncommitted work. Combined with TM-247 the task is then stranded. Fix options: tell the worker in the handoff that it runs non-interactively and must run every command in the foreground and never end its turn before committing or blocking; and/or have the backend detect an exit with uncommitted changes and no finish/block and record it distinctly.