---
id: "TM-292"
kind: "task"
status: "open"
created: "2026-10-02T13:09:10.590Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management dispatch: a claude -p worker that backgrounds a long command and ends its turn exits mid-task"
epic: "EP-019"
acceptance: [{"text":"the dispatch handoff tells a print-mode worker to run commands in the foreground and not end its turn until it has committed and reported, or blocked","done":false},{"text":"an exit with no finish report, no block and a dirty worktree is recorded as 'exited mid-task' (not a normal exit), naming the last assistant message; unit test","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@dc778cb2"
session: "dc778cb2"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:40:45.244Z"
links: [{"type":"relates to","id":"TM-247"}]
comments: [{"author":"@dc778cb2","ts":"2026-10-02T13:40:17.110Z","text":"QUEUED NEXT (operator decision 2026-10-02): dispatched by the Bastion lead as soon as marketplace WIP (12/12) has room. Its touches are disjoint from the TM-247 slice."},{"author":"@dc778cb2","ts":"2026-10-02T13:40:45.240Z","text":"Touches note: 'task-management/lib/handoff.mjs' and '-task-management/lib/handoff.mjs' were added by mistake (no such file; the handoff renderer is task-management/lib/render.mjs). tm touches has no removal syntax, so they stay; they match nothing."}]
priority: "high"
touches: ["-task-management/lib/handoff.mjs","task-management/lib/dispatch/tmux.mjs","task-management/lib/handoff.mjs","task-management/lib/render.mjs","task-management/tests/unit"]
---

Observed 2026-10-02 on marketplace TM-276 and TM-287 (dispatched by Bastion lead dc778cb2 through manage start-worker, tmux backend). The tmux backend runs DEFAULT_COMMAND claude -p --dangerously-skip-permissions (task-management/lib/dispatch/tmux.mjs:39). In print mode the process exits when the model ends its turn. TM-276's worker started the full unit suite with run_in_background, wrote 'Full unit suite is still running. Once it finishes, I'll commit, push and open the PR.', and ended its turn: claude exited, the pane closed, the suite was orphaned, and tm collect recorded 'worker exited without closing' with uncommitted work. Combined with TM-247 the task is then stranded. Fix options: tell the worker in the handoff that it runs non-interactively and must run every command in the foreground and never end its turn before committing or blocking; and/or have the backend detect an exit with uncommitted changes and no finish/block and record it distinctly.