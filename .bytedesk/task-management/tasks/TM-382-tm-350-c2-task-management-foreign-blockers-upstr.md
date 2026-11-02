---
id: "TM-382"
kind: "task"
status: "done"
created: "2026-10-05T10:59:39.633Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-350 C2 task-management: foreign blockers, upstream-resolved verb, filed-by intake"
epic: "EP-028"
acceptance: [{"text":"tm dep X owner/repo#TM-n stores a foreign blocker in foreignBlockers[] (not blockedBy) and sets status blocked","done":true,"at":"2026-10-05T11:26:51.453Z"},{"text":"dependenciesMet/unblockDependents treat an unresolved foreign blocker as unmet; a test proves a missing foreign blocker does not unblock","done":true,"at":"2026-10-05T11:26:51.837Z"},{"text":"tm upstream-resolved <ref> --landed <sha> resolves it and reopens via unblockDependents, emitting unblocked","done":true,"at":"2026-10-05T11:26:52.223Z"},{"text":"tm task new --filed-by <board>/<agent>/<task> writes filedBy plus the decision:intake readiness veto, and completeness/readiness honours the veto (tested)","done":true,"at":"2026-10-05T11:26:52.608Z"}]
evidence: [".bytedesk/task-management/evidence/TM-382-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/186","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: ["TM-383","TM-385","TM-386"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration","plugin:task-management"]
triagedBy: "auto"
updated: "2026-10-05T15:29:42.763Z"
parent: "TM-350"
evidenceSources: {".bytedesk/task-management/evidence/TM-382-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-382-landing.md","sha256":"73e2042f89ef3158a55596051f43eb35ab5bce1490d0ff6aae5d52cd6056ae3b","bytes":832,"at":"2026-10-05T11:26:53.019Z"}}
closed: "2026-10-05T11:26:53.499Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:32.569Z","text":"review-sweep: TM-382 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:29:42.758Z","text":"Independent review verdict: approved (lead-dispatched reviewer, 3 rounds; R3 APPROVE at 2e7fdd7c) — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/186#issuecomment-5993493920"}]
---

ADR-0041. Owns task-management/lib/issue.mjs, lib/store.mjs, bin/tm (dep, task new, new upstream-resolved verb), tests. Never put foreign ids in blockedBy (dependenciesMet treats a missing blocker as resolved, store.mjs:1379).