---
id: "TM-211"
kind: "task"
status: "open"
created: "2026-09-23T22:21:44.465Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: observer census finding merges a read failure with staleness, and the census CLI hides the state it reports"
epic: "EP-019"
acceptance: [{"text":"A thrown read, a missing file and a stale file produce distinct evidence values (read-error, missing, stale with ageMs); only missing or stale is classified as breaking.","done":false},{"text":"Repository inspection reads the census for attachment.repository whatever --consumer is; a test runs it from a different repository.","done":false},{"text":"'census --json' reports whether the document came from the supervisor or was taken by the CLI, including the published document's at and stale before any replacement.","done":false},{"text":"The finding record sets delivery.resolved when a later inspection no longer shows the condition.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-23T22:21:50.901Z"
---

Observer b3004241 raised 'repository census is missing or stale' 92 times on 2026-09-17, then called it a false positive because census measured 1s fresh. Verified 2026-09-23 that the proof is circular: the census CLI (topology/cli.mjs:320-336) activates the supervisor and, when the published document is missing or stale, takes and writes its own census (census.mjs:371), always reporting stale:false. So checking the finding repairs it, which is why it 'self-cleared'. Meanwhile observer.mjs:180-183 turns any readCensus error (.catch(() => null)) into a breaking supervisor-down finding, so a read failure and a real tick lapse look the same. Latent: inspectObservedRun resolves the census from the CLI --consumer, not attachment.repository. Consumer-path mismatch was ruled out for this incident (both gateway paths resolve to key b446b05ed9da844e).