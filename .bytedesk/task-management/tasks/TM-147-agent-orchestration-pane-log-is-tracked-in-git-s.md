---
id: "TM-147"
kind: "task"
status: "open"
created: "2026-09-10T01:22:32.482Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: pane.log is tracked in git, so every agent action permanently dirties the shared checkout"
acceptance: [{"text":"pane.log files are gitignored and no longer tracked","done":false},{"text":"The logs still exist on disk and are still written","done":false},{"text":"git status in the shared checkout is clean when no agent has pending work","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:22:37.706Z"
type: "bug"
labels: ["plugin:agent-orchestration"]
---

04d26a6 committed `.bytedesk/agent-orchestration/agents/fd2b831f/pane.log` into git. It is a live, append-only terminal log: it is rewritten every time the agent that owns it does anything.

Consequence in a shared checkout with a single writer: the tree is never clean. Every commit either sweeps unrelated terminal noise into itself or is made against a dirty tree, and `git status` stops being a usable signal for 'is there unowned work here'. That already caused a false report this session — a conductor reading status attributed a change to an unowned party when the only dirty file was one agent's own log.

Fix: gitignore `.bytedesk/agent-orchestration/agents/*/pane.log` and `git rm --cached` the tracked copies. The logs stay on disk for whoever wants to read a pane; they stop being repository content.

Deliberately not done by the integrator without a decision: it removes files another session committed, and the ignore rule affects every agent directory, not just the one that is dirty today.