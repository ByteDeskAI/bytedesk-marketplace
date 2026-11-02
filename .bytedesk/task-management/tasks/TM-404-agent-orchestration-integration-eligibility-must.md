---
id: "TM-404"
kind: "task"
status: "open"
created: "2026-10-05T13:36:20.807Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: integration eligibility must refuse a base_source 'local-fallback' admission that the server never confirmed"
epic: "EP-028"
acceptance: [{"text":"manage eligible and integrate refuse, with a named code, a task whose admission base_source is local-fallback and has never been server-confirmed","done":false},{"text":"Once a server merge-base check succeeds and widens or confirms the range, eligibility proceeds; tested both ways","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:22:16.362Z"
comments: [{"author":"main","ts":"2026-10-08T23:22:16.357Z","text":"From the PR #221 round-3 review (2026-10-08): for local-fallback admissions the review range is re-derived from GitHub on every sweep (widened bases are never TM-259-pinned). During a GitHub rate limit or outage it falls back to the admitted base and can flip an approval to 'does not cover the range' — fail-closed, but the flip TM-259 exists to avoid. Consider pinning a server-confirmed widened base once confirmed."}]
---

Residual from the PR #192 (TM-349) round-2 review, 2026-10-05: when the server is unreachable at admission AND at review, a worker can forge every local candidate ref so the recorded base is its own commit, and review never sees that commit. base_source 'local-fallback' is recorded but nothing gates on it. Integration eligibility (manage eligible / integrate) should refuse until the base is server-confirmed, i.e. a later server merge-base check succeeds and the review range is widened accordingly.