---
id: "TM-428"
kind: "task"
status: "blocked"
created: "2026-10-05T15:27:15.557Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY agent-orchestration reviewer: an untracked .gitattributes in the worker's worktree hides code from the review patch"
epic: "EP-028"
acceptance: [{"text":"Every review git command (range, patch, numstat, binary manifest, patch hash) runs against the consumer repository or with --attr-source=<empty tree>, never with the worker worktree's attributes; the reviewer's repro shows the text diff","done":false},{"text":"A non-empty info/attributes in the common git dir is refused for review (or binary-ness is computed without attributes)","done":false},{"text":"Regression tests for both","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-09T01:21:45.422Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T15:35:40.295Z","text":"Security review (w-secreview): TM-260's --text/--no-textconv defeats .gitattributes, but binary is still decided by a NUL in the first 8000 bytes, which the author controls (Node runs a .mjs with a NUL in a comment), so source can still collapse to a manifest row. Fix: diff source-extension/text-path files as --text regardless, or make any binary row under touches an unsatisfied checklist item."},{"author":"main","ts":"2026-10-05T15:50:20.126Z","text":"rv-gov on #210 independently confirmed the NUL case: '// \\0' in a .mjs keeps it runnable and collapses its diff to a manifest row; files/<path> is omitted from the packet. Real images must still be manifest-only (test)."},{"author":"main","ts":"2026-10-09T01:00:20.311Z","text":"Implemented inside the TM-427 governed cluster worker (tmux:tm-TM-427) per TM-427 comment 7; one PR against main."}]
blockedReason: "Designed (sec-review-gate report); no worker in the lead session can edit files (no Edit/Write; worktree guard refuses heredoc edits with git args). Ryan chose tm dispatch. Dispatch after PR #226 (safe-git/trustedGh) merges; ships in agent-orchestration 0.16.2. Interim mitigation in 0.16.1: #222 denies 'review submit' for workers in auto mode."
---

From the post-merge review of PR #205 (TM-366, shipped in v0.16.0). taskTree / trustedReviewRange / binaryFileManifest run git -C <worker worktree> diff, and git takes attributes from that working tree. Reproduced (git 2.43): an untracked .gitattributes with 'evil.js -diff' turns the patch into 'Binary files /dev/null and b/evil.js differ' and numstat '- -', so the content becomes a hash+size manifest line; from the main checkout the same diff shows the code. The patch hash is recomputed from the same tree, so it stays consistent through land. Also pre-existing: $GIT_COMMON_DIR/info/attributes hides content even from the main checkout and --attr-source does not neutralise it.