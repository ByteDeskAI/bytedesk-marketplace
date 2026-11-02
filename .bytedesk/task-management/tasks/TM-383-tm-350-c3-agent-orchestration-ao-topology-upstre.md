---
id: "TM-383"
kind: "task"
status: "open"
created: "2026-10-05T10:59:41.054Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-350 C3 agent-orchestration: ao-topology upstream file"
epic: "EP-028"
acceptance: [{"text":"One command files upstream, records the foreign dependency, notifies the upstream lead and writes a subscription","done":false},{"text":"Rerun is idempotent (no duplicate upstream ticket); non-lead callers are refused","done":false},{"text":"An upstream tm without --filed-by is refused with a named error","done":false}]
evidence: []
commits: []
blockedBy: ["TM-382","TM-347","TM-348","TM-349"]
blocks: ["TM-385","TM-386"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-08T23:33:45.228Z"
parent: "TM-350"
---

ADR-0041. Owns new topology/lib/upstream.mjs, a cli.mjs dispatch hunk (after TM-347..349 merge), tests. Proves lead caller; runs upstream tm task new --filed-by; consumer tm dep <local> <board>#TM-n; sendStandingMessage notice to upstream lead; subscription file under stateRoot()/upstream-subscriptions/.