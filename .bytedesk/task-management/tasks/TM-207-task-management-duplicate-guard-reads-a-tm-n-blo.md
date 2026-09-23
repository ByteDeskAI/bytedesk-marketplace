---
id: "TM-207"
kind: "task"
status: "open"
created: "2026-09-23T22:20:59.754Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: duplicate guard reads a 'TM-n: blocked on X' subject as done, and its refusal carries no failure scope"
epic: "EP-021"
acceptance: [{"text":"duplicateCommits returns [] for a commit whose subject is 'TM-9: blocked on X' and for 'TM-9: blocked', and still matches 'fix(TM-9): done'.","done":false},{"text":"The duplicate refusal returns failureScope 'task' explicitly, and pool breaker classification uses that field rather than matching the refusal text.","done":false},{"text":"tests/unit/dispatch-duplicate.test.mjs covers both, and fails if either change is reverted.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-09-23T22:21:51.286Z"
comments: [{"author":"main","ts":"2026-09-23T22:21:51.282Z","text":"Pool-side check on 2026-09-23 (c895936) confirmed the second gap: the duplicate refusal at lib/dispatch/index.mjs:122-126 carries no failureScope and is kept out of the breaker only by the scope fallback. TM-212 touches the same classifier (failure.mjs), so do these together or sequence them."}]
---

Observer b3004241 reported on 2026-09-17 that the dispatch duplicate guard treated 'blocked on TM-358' as proof TM-358 was done. Most of that was fixed in c0a66d6: task-management/lib/dispatch/duplicate.mjs:46-78 now searches only the integration branch and needs an explicit subject marker or trailer. Verified 2026-09-23 by calling duplicateCommits on a throwaway repo: body mentions and 'chore: blocked on TM-9' return [] and the control 'fix(TM-9): real completion' matches. Two gaps remain. (1) The subject 'TM-9: blocked on upstream API' still matches, because the exclusion list has 'blocked by' but not 'blocked on' or bare 'blocked'. (2) The refusal in lib/dispatch/index.mjs:125 has no failureScope or code; failure.mjs:5 keeps it out of the pool breaker only because its text happens to contain 'duplicate'.