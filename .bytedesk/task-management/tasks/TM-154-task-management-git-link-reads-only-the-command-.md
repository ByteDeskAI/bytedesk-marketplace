---
id: "TM-154"
kind: "task"
status: "done"
created: "2026-09-10T02:17:09.202Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: git-link reads only the command string, so a commit authored with -F or a heredoc attaches nothing"
acceptance: [{"text":"A commit whose message names TM-nnn attaches, whether written with -m, -F or a heredoc","done":true,"at":"2026-09-10T03:22:08.116Z"},{"text":"A commit whose message names no task still attaches nothing and records git_link_unattributed","done":true,"at":"2026-09-10T03:22:08.237Z"},{"text":"A test covers the -F case specifically, since it is the one the command-string reader cannot see","done":true,"at":"2026-09-10T03:22:08.413Z"}]
evidence: [".bytedesk/task-management/evidence/TM-154-HANDOFF.md"]
commits: ["d60606b","06fa198","578498b"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:22:08.557Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-154-HANDOFF.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-154-message/.bytedesk/task-management/evidence/TM-154-HANDOFF.md","sha256":"4a0f08b181b5050ef4f772f7ba0a84bc4c2b9bfea46bbcdd3d2de0c3d3239b01","bytes":2972,"at":"2026-09-10T03:17:57.862Z"}}
comments: [{"author":"main","ts":"2026-09-10T03:22:07.982Z","text":"MERGED at 578498b, and it proved itself the way TM-146 did — with one caveat that is now TM-158.\n\nTHE FIX WORKS: 578498b was written with -F and its subject reads \"Merge TM-154: read the commit message, not just the command string\". It attached to TM-154. Before this merge the same shape attached nothing.\n\nTHE CAVEAT, found in the same observation: it attached to NINE tasks, not one — TM-130, TM-131, TM-135, TM-140, TM-141, TM-145, TM-146, TM-153 and TM-154. The eight wrong ones have been stripped by hand.\n\nThe cause is NOT this branch code, which reads subject and trailers exactly as promised. linkGit takes the UNION of command-string ids and message ids:\n\n  const mentioned = [...(cmd.match(/TM-\\\\d+/g) || []), ...(isPRCommand ? [] : idsFromCommitMessage())];\n\nThe command string is still trusted in full. This session writes commit messages with a heredoc in the SAME Bash invocation as the commit, so the entire message body — which discussed eight other tasks in prose — was in the command string. The subject-only reading was bypassed before it was consulted.\n\nSo TM-154 guarantee is true in code and false in practice for the commit style both agents on this epic actually use. That is TM-158, filed high. It is not a regression from this branch: the command-string path predates it and TM-146 left it in place deliberately, because at that point it was the only signal. Now that the message is readable, trusting the command for a `git commit` buys nothing and costs this.\n\nCONFIRMED HERE: gates on the merged tree, task-management unit 1366/1366; hooks 65, hooks2 37, store 134, link 13, mcp 77, read 59, all exit 0. test-pool not re-run, known red at 17/2 under TM-153. Trap tests verified non-vacuous independently — the branch test file alone over an unmodified archive of main fails exactly its two new assertions, the -F subject case and the Refs: trailer.\n\nThe CHANGELOG conflicted with TM-145 under the same heading. Resolved keeping both, and TM-145 census text was corrected during the resolution rather than shipped as written — it described 11/4/1 and nineteen referencing records, which a later count disproved, and it did not carry the load-bearing category at all.\n\nThe narrow trailer set is right and worth defending: Refs, Closes, Fixes, Task count; a mention in prose does not. Bodies in this repo reason about other tasks constantly — this comment does it four times — and attaching to every id someone thought about is exactly the failure TM-146 existed to end."}]
closed: "2026-09-10T03:22:08.552Z"
---

`linkGit` selects its target with `cmd.match(/\bTM-\d+\b/g)` — the Bash COMMAND STRING — and never reads the commit message. So `git commit -F <file>` and `git commit` with a heredoc attach nothing, however clearly the message names its task. Only `git commit -m "TM-nnn: …"` inline, or a `tm/<ID>-` branch, is seen.

This is not caused by TM-146; TM-146 makes it VISIBLE. The claim fallback used to catch these commits and often produced the right task by luck, which is exactly the unsound behaviour TM-146 removed. Now they correctly attach nothing — and correctly is still wrong when the message names the task on its first line.

Observed immediately: the merge commit for TM-146 itself, `8e387d3`, has the subject "Merge TM-146: a claim no longer attaches a ref to a task" and attached to nothing, because the id lived in the message file rather than the command. Every commit this integrator session makes uses `-F`, for messages too long to be readable inline, so the whole integration record is currently unattributed.

The fix is small and the evidence is already to hand: for `git commit`, read `git log -1 --format=%B` after the fact — the hook already runs `rev-parse` at that point, so the commit exists and its message is retrievable. For `gh pr create`, the PR body is in the command or the response.

Keep TM-146's rule intact: the message naming a task is an EXPLICIT statement about what changed, which is what TM-146 requires. A claim is not. This adds a second explicit signal, it does not restore the guess.