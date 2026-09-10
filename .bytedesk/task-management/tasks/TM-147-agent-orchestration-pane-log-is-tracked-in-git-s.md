---
id: "TM-147"
kind: "task"
status: "blocked"
created: "2026-09-10T01:22:32.482Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: pane.log is tracked in git, so every agent action permanently dirties the shared checkout"
acceptance: [{"text":"pane.log files are gitignored and no longer tracked","done":false},{"text":"The logs still exist on disk and are still written","done":false},{"text":"git status in the shared checkout is clean when no agent has pending work","done":false}]
evidence: [".bytedesk/task-management/evidence/TM-147-MERGE-SEQUENCE.md"]
commits: ["c87d2f9","2772d30","01f7bd4","ffa3355","c6eb20c","4a646cc"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:54:15.779Z"
type: "bug"
labels: ["plugin:agent-orchestration"]
evidenceSources: {".bytedesk/task-management/evidence/TM-147-MERGE-SEQUENCE.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-147-panelog/.bytedesk/task-management/evidence/TM-147-MERGE-SEQUENCE.md","sha256":"9f31eb00228d4b6daa01ff2bf310135b9f8b8336901b9d831dd1482b805a9b1a","bytes":3989,"at":"2026-09-10T03:54:15.642Z"}}
blockedReason: "Branch ready, but DO NOT MERGE IT THE ORDINARY WAY — the sequence is in the evidence and it is not optional. Branch tm/TM-147-panelog-untrack off main@6546f79, commit e8e2560: .gitignore gains the pane.log rules with the reason beside them, and git rm --cached removes the two tracked logs (eff264fa 1.4MB, fd2b831f 375KB). I measured BOTH failure modes on a throwaway repository rather than reasoning about them: with the log DIRTY the merge refuses with 'Your local changes would be overwritten' — which is the failure that has been happening all session; with the log CLEAN the merge succeeds and DELETES THE LOG FROM DISK, taking the emptied agent directory with it. The working sequence is copy aside, checkout to clean, merge, mkdir -p, restore — the mkdir -p is required and is where my own first attempt failed. Verified end to end: log restored with the line appended after the last commit, git ls-files returns 0 pane.log, git status returns 0 dirty files, which is all three ACs at once. RESIDUAL I cannot fix from here: a live agent's tmux holds an open descriptor, so after the restore its future writes go to the unlinked inode until its pane is re-piped — the restored file is a snapshot up to the merge. The cleanest time to run this is when no agent is live. THE ACs ARE NOT TICKED because they describe the state of the SHARED CHECKOUT after the merge, which is the integrator's action, not mine."
---

04d26a6 committed `.bytedesk/agent-orchestration/agents/fd2b831f/pane.log` into git. It is a live, append-only terminal log: it is rewritten every time the agent that owns it does anything.

Consequence in a shared checkout with a single writer: the tree is never clean. Every commit either sweeps unrelated terminal noise into itself or is made against a dirty tree, and `git status` stops being a usable signal for 'is there unowned work here'. That already caused a false report this session — a conductor reading status attributed a change to an unowned party when the only dirty file was one agent's own log.

Fix: gitignore `.bytedesk/agent-orchestration/agents/*/pane.log` and `git rm --cached` the tracked copies. The logs stay on disk for whoever wants to read a pane; they stop being repository content.

Deliberately not done by the integrator without a decision: it removes files another session committed, and the ignore rule affects every agent directory, not just the one that is dirty today.