---
id: "TM-159"
kind: "task"
status: "done"
created: "2026-09-10T03:23:12.482Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a heredoc commit message floods the command string, defeating the subject-only guard"
acceptance: [{"text":"A heredoc-authored commit whose subject names one task attaches to that task only, not to every id in its body","done":true,"at":"2026-09-10T03:36:58.511Z"},{"text":"A -m commit naming a task inline still attaches","done":true,"at":"2026-09-10T03:36:58.645Z"},{"text":"gh pr create still attaches from its command, having no committed message to read","done":true,"at":"2026-09-10T03:36:58.767Z"},{"text":"A test drives the heredoc-in-same-command shape, since that is what defeats the current guard","done":true,"at":"2026-09-10T03:36:58.922Z"}]
evidence: [".bytedesk/task-management/evidence/TM-159-HANDOFF.md"]
commits: ["e160820","80edb4a","e2b1807","435bb03"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:36:59.067Z"
type: "bug"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-159-HANDOFF.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-159-cmd/.bytedesk/task-management/evidence/TM-159-HANDOFF.md","sha256":"a6d6b8a11eb1553492ec302e477f8eac909aa54fca35d806d99fc5a0b5dba571","bytes":3353,"at":"2026-09-10T03:30:16.649Z"}}
blockedReason: "Code complete and gated; blocked on the integrator's merge only. Branch tm/TM-159-command-string off main@d386660, code commit e160820. For a git commit the command string is no longer read at all — only git log -1's subject and explicit trailers. Nothing is lost: -m puts the id in the message too, and a -F or heredoc message was never in the command. gh pr create still reads its command, having no committed message. THE CONTROL: the new heredoc assertion fails against main WITH TM-154 already merged, so it reproduces the nine-task attach rather than describing it; with the fix test-hooks2 is 40/40. Gates: unit 1366/1366, hooks2 40, hooks 65, capability 22, concurrency 12, dashboard 210, events 12, install 13, link 13, mcp 77, read 59, store 140, worktree 22 — all clean; test-pool 17/2 is TM-153 and fails identically in the canonical checkout. One pre-existing TM-146 assertion had to be corrected: it drove the hook with -m naming a task WITHOUT making a commit carrying that message, and passed only via the command-string shortcut it was meant to protect against. This commit is its own test case — e160820's subject names TM-159 and its body names TM-154, so after the merge it should attach to TM-159 only."
comments: [{"author":"main","ts":"2026-09-10T03:36:58.367Z","text":"MERGED at 435bb03 and verified in production. The merge commit subject names no task, its body names several, and it attached to NOTHING — recording git_link_unattributed with the branch and reason. That is the designed behaviour and the previous code would have attached to every id in the body.\n\nTHE FIX IS THE BROADER ONE, NOT THE NARROWER, and that was the right choice. For a git commit the command string is no longer read at all:\n\n  const mentioned = isPRCommand ? (cmd.match(/TM-\\\\d+/g) || []) : idsFromCommitMessage();\n\nNothing is lost. `-m \"TM-nnn: …\"` puts the id in the message too, so git log still sees it, and a -F or heredoc message was never in the command anyway. What goes is the only route by which a task merely MENTIONED in prose could attach. gh pr create keeps reading its command, because there is no committed message to read instead.\n\nTHE CONTROL IS THE SHARPEST ONE EITHER AGENT HAS PRODUCED THIS EPIC. The new assertion applied over main WITH the previous fix already merged FAILS — it reproduces the nine-task attach rather than describing it. Verified independently here before merging: 39 passed, 1 failed in an archive of main, and the failure is exactly \"a task discussed in the body does NOT attach, even though the heredoc put it in the command string\".\n\nONE PRE-EXISTING ASSERTION HAD TO CHANGE AND DESERVED TO, and this is the part worth remembering. The older test drove the hook with -m \"…TM-002\" WITHOUT ever creating a commit carrying that message. It passed only because the id was read from the command string — so the suite that exists to prevent over-attachment was itself relying on the loose path that caused it. A test that never makes the artifact it describes will pass for whatever reason happens to be available.\n\nGates on the merged tree, exit codes captured: unit 1366/1366; hooks 65, hooks2 40, store 140, link 13, mcp 77, read 59 — all exit 0."}]
closed: "2026-09-10T03:36:59.062Z"
---

TM-154 reads the commit SUBJECT and explicit trailers, never the body, so prose reasoning about other tasks does not attach refs to them. The code does exactly that. The guarantee is still false in practice.

linkGit takes the UNION of both sources — the command string is still trusted in full. So when the message is written by heredoc or printf in the SAME Bash invocation as the commit, every task id in the message body is in the command string, and the subject-only reading is bypassed before it is consulted.

Observed twice within minutes. Merge commit 578498b attached to NINE tasks because its message discussed eight others in prose; its subject names only one. Then b0732c9, written with printf instead of a heredoc, attached to three for the same reason. Both were corrected by hand.

Not a regression from TM-154: the command-string path predates it, and when TM-146 left it in place it was the only signal available. Now that the message is readable, trusting the command string for a git commit buys nothing and costs this.

Options: narrow ids found in the command string the same way when the command is a git commit that names a message file; or stop reading the command string for git commit entirely, keeping it only for gh pr create where there is no committed message to read.