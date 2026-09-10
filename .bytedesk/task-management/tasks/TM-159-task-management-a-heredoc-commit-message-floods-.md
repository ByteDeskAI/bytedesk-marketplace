---
id: "TM-159"
kind: "task"
status: "in_progress"
created: "2026-09-10T03:23:12.482Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a heredoc commit message floods the command string, defeating the subject-only guard"
acceptance: [{"text":"A heredoc-authored commit whose subject names one task attaches to that task only, not to every id in its body","done":false},{"text":"A -m commit naming a task inline still attaches","done":false},{"text":"gh pr create still attaches from its command, having no committed message to read","done":false},{"text":"A test drives the heredoc-in-same-command shape, since that is what defeats the current guard","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:26:55.372Z"
type: "bug"
priority: "high"
---

TM-154 reads the commit SUBJECT and explicit trailers, never the body, so prose reasoning about other tasks does not attach refs to them. The code does exactly that. The guarantee is still false in practice.

linkGit takes the UNION of both sources — the command string is still trusted in full. So when the message is written by heredoc or printf in the SAME Bash invocation as the commit, every task id in the message body is in the command string, and the subject-only reading is bypassed before it is consulted.

Observed twice within minutes. Merge commit 578498b attached to NINE tasks because its message discussed eight others in prose; its subject names only one. Then b0732c9, written with printf instead of a heredoc, attached to three for the same reason. Both were corrected by hand.

Not a regression from TM-154: the command-string path predates it, and when TM-146 left it in place it was the only signal available. Now that the message is readable, trusting the command string for a git commit buys nothing and costs this.

Options: narrow ids found in the command string the same way when the command is a git commit that names a message file; or stop reading the command string for git commit entirely, keeping it only for gh pr create where there is no committed message to read.