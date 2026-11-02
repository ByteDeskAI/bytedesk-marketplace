---
id: "TM-510"
kind: "task"
status: "done"
created: "2026-10-09T05:04:56.936Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: session start fast-forwards the marketplace checkout so every machine gets plugin updates"
epic: "EP-028"
acceptance: [{"text":"SessionStart fast-forwards a behind main checkout of the registered marketplace and the post-merge sync runs; throttled to once per 10 minutes; skips worktrees, other branches and diverged checkouts","done":true,"at":"2026-10-09T05:10:44.863Z"},{"text":"Test with a temp origin and clone covers ff, throttle, wrong branch and diverged; existing plugin-rsync tests still pass","done":true,"at":"2026-10-09T05:10:45.354Z"}]
evidence: [".bytedesk/task-management/evidence/TM-510-evidence.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/246","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/247","77c05462"]
blockedBy: []
blocks: []
actor: "main"
session: "2e1a5469-e106-4fa6-a7ed-35e999950137"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:41:06.872Z"
parkedReason: "waiting on AI review of PR #246"
evidenceSources: {".bytedesk/task-management/evidence/TM-510-evidence.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-510-evidence.md","sha256":"5c29448059103c3b97e70cc6535e4710f443e7186d2e31dd1d2208afdc03d6dc","bytes":802,"at":"2026-10-09T05:10:45.773Z"}}
closed: "2026-10-09T05:10:46.235Z"
comments: [{"author":"review-sweep","ts":"2026-10-09T05:10:49.344Z","text":"review-sweep: TM-510 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T05:13:16.519Z","text":"Post-merge independent review (review-246, 2026-10-09) of PR #246 at 77c05462: CHANGES_REQUESTED, handled forward by TM-511 (no revert). The pull itself is safe: it uses --ff-only, refuses on a dirty same-file conflict, and is throttled and backgrounded. Medium: the post-merge sync copies uncommitted plugin edits from the working tree into the live caches. Medium: the test has no dirty-tree case, and it stays green with the guard removed. Low: the stamp is written before the fetch, so a failed pull blocks retries; the fetch has no timeout; any marketplace clone is pulled, not only the registered one."},{"author":"main","ts":"2026-10-09T05:13:33.114Z","text":"Correction: the follow-up task is TM-513, not TM-511."},{"author":"main","ts":"2026-10-09T05:41:06.862Z","text":"Follow-up TM-513 merged at 25af751d (PR #247); the review-246 findings on #246 are resolved."}]
---

Other machines only get plugin updates when someone runs git pull in their marketplace checkout. The plugin-rsync SessionStart hook should fetch origin/main and fast-forward the registered marketplace checkout (main checkout, on main, at most every 10 minutes, in the background), so the post-merge hook rsyncs the touched plugins into the Claude/Codex/Grok caches. ff-only: never touches local commits or conflicting dirty files.