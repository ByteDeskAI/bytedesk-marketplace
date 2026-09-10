---
id: "TM-154"
kind: "task"
status: "open"
created: "2026-09-10T02:17:09.202Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: git-link reads only the command string, so a commit authored with -F or a heredoc attaches nothing"
acceptance: [{"text":"A commit whose message names TM-nnn attaches, whether written with -m, -F or a heredoc","done":false},{"text":"A commit whose message names no task still attaches nothing and records git_link_unattributed","done":false},{"text":"A test covers the -F case specifically, since it is the one the command-string reader cannot see","done":false}]
evidence: []
commits: ["TM-146","ffa3355"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T02:17:43.950Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "high"
---

`linkGit` selects its target with `cmd.match(/\bTM-\d+\b/g)` — the Bash COMMAND STRING — and never reads the commit message. So `git commit -F <file>` and `git commit` with a heredoc attach nothing, however clearly the message names its task. Only `git commit -m "TM-nnn: …"` inline, or a `tm/<ID>-` branch, is seen.

This is not caused by TM-146; TM-146 makes it VISIBLE. The claim fallback used to catch these commits and often produced the right task by luck, which is exactly the unsound behaviour TM-146 removed. Now they correctly attach nothing — and correctly is still wrong when the message names the task on its first line.

Observed immediately: the merge commit for TM-146 itself, `8e387d3`, has the subject "Merge TM-146: a claim no longer attaches a ref to a task" and attached to nothing, because the id lived in the message file rather than the command. Every commit this integrator session makes uses `-F`, for messages too long to be readable inline, so the whole integration record is currently unattributed.

The fix is small and the evidence is already to hand: for `git commit`, read `git log -1 --format=%B` after the fact — the hook already runs `rev-parse` at that point, so the commit exists and its message is retrievable. For `gh pr create`, the PR body is in the command or the response.

Keep TM-146's rule intact: the message naming a task is an EXPLICIT statement about what changed, which is what TM-146 requires. A claim is not. This adds a second explicit signal, it does not restore the guess.