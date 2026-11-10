---
id: "TM-558"
kind: "task"
status: "open"
created: "2026-11-10T21:07:40.472Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management dispatch: a task whose handoff exceeds tmux's command limit cannot be dispatched (tmux new-session exited 1: command too long)"
epic: "EP-029"
acceptance: [{"text":"A task whose handoff is over 64 KB dispatches successfully and the worker receives the full prompt","done":false},{"text":"A unit test builds argv for an oversized prompt and asserts the tmux argv stays under 16 KB","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "72f1fc09-2253-4281-a926-682424a11029"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-10T21:08:01.939Z"
priority: "high"
---

tmux.mjs argvFor() (task-management/lib/dispatch/tmux.mjs:223-242) passes the whole worker prompt as one argv element to 'tmux new-session'. tmux refuses a command over its message limit (about 16 KB), so any task whose rendered handoff is that large fails dispatch with 'tmux new-session exited 1: command too long'. Seen 2026-11-10 on TM-556: its body embedded a 555-line proceval JSON record, and .tm-dispatch-prompt.md was 17,222 bytes. The lead worked around it by moving the record to evidence/TM-556-proceval-first-sighting.txt. Any auto-filed task carrying a large evidence block (proceval, memwatch) will hit this. Repro: create a task with a body over 16 KB, admit it, run tm dispatch <id>. Fix direction: the prompt file spawn() already writes is the durable copy; deliver from it inside the pane (for example a sh wrapper that execs claude -p "$(cat file)"), keeping argv free of the prompt, or cap and summarise long evidence blocks in the handoff with a pointer.