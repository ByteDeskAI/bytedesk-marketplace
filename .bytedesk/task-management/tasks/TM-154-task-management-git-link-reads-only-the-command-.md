---
id: "TM-154"
kind: "task"
status: "blocked"
created: "2026-09-10T02:17:09.202Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: git-link reads only the command string, so a commit authored with -F or a heredoc attaches nothing"
acceptance: [{"text":"A commit whose message names TM-nnn attaches, whether written with -m, -F or a heredoc","done":true,"at":"2026-09-10T03:17:57.310Z"},{"text":"A commit whose message names no task still attaches nothing and records git_link_unattributed","done":true,"at":"2026-09-10T03:17:57.473Z"},{"text":"A test covers the -F case specifically, since it is the one the command-string reader cannot see","done":true,"at":"2026-09-10T03:17:57.684Z"}]
evidence: [".bytedesk/task-management/evidence/TM-154-HANDOFF.md"]
commits: ["TM-146","ffa3355","fa18b8c"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:17:58.018Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-154-HANDOFF.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-154-message/.bytedesk/task-management/evidence/TM-154-HANDOFF.md","sha256":"4a0f08b181b5050ef4f772f7ba0a84bc4c2b9bfea46bbcdd3d2de0c3d3239b01","bytes":2972,"at":"2026-09-10T03:17:57.862Z"}}
blockedReason: "Code complete and gated; blocked on the integrator's merge only. Branch tm/TM-154-git-link-message off main@1910b95, code commit d60606b. linkGit now also reads git log -1 --format=%B, but only the SUBJECT line and explicit trailers (Refs/Closes/Fixes/Task) — never the whole body, because bodies here reason about other tasks in prose and attaching a ref to every id mentioned would recreate TM-146's over-attachment by another route. TM-146's rule is intact: an explicit statement about what changed, not a guess. Four new assertions; two fail against unmodified main, including the -F case the command-string reader could never see. Gates: 1364/1364 unit, every bash suite clean except test-pool.sh which is TM-153 and fails identically in the canonical checkout. This commit was written with -F on purpose and did NOT attach, correctly, because the running hook is main's unfixed copy — after the merge the same shape will attach, which is the check."
---

`linkGit` selects its target with `cmd.match(/\bTM-\d+\b/g)` — the Bash COMMAND STRING — and never reads the commit message. So `git commit -F <file>` and `git commit` with a heredoc attach nothing, however clearly the message names its task. Only `git commit -m "TM-nnn: …"` inline, or a `tm/<ID>-` branch, is seen.

This is not caused by TM-146; TM-146 makes it VISIBLE. The claim fallback used to catch these commits and often produced the right task by luck, which is exactly the unsound behaviour TM-146 removed. Now they correctly attach nothing — and correctly is still wrong when the message names the task on its first line.

Observed immediately: the merge commit for TM-146 itself, `8e387d3`, has the subject "Merge TM-146: a claim no longer attaches a ref to a task" and attached to nothing, because the id lived in the message file rather than the command. Every commit this integrator session makes uses `-F`, for messages too long to be readable inline, so the whole integration record is currently unattributed.

The fix is small and the evidence is already to hand: for `git commit`, read `git log -1 --format=%B` after the fact — the hook already runs `rev-parse` at that point, so the commit exists and its message is retrievable. For `gh pr create`, the PR body is in the command or the response.

Keep TM-146's rule intact: the message naming a task is an EXPLICIT statement about what changed, which is what TM-146 requires. A claim is not. This adds a second explicit signal, it does not restore the guess.