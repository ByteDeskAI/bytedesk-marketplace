---
id: "TM-216"
kind: "task"
status: "done"
created: "2026-09-24T17:16:16.508Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: review packet, per-repo checklist, revision-bound check evidence"
epic: "EP-028"
acceptance: [{"text":"Packet written and hashed; a changed packet refuses collection; unit tests","done":true,"at":"2026-10-05T15:27:29.950Z"},{"text":"Per-repo checklist loaded from the consumer repo and injected; missing check evidence yields blocked; unit tests","done":true,"at":"2026-10-05T15:27:30.469Z"},{"text":"Eligibility refuses checks recorded at another revision or with nonzero exit; unit tests","done":true,"at":"2026-10-05T15:27:30.942Z"},{"text":"Reviewer stays unable to write or execute; unit suite passes; CHANGELOG entry","done":true,"at":"2026-10-05T15:27:31.356Z"}]
evidence: [".bytedesk/task-management/evidence/TM-216-1791214051757.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/210","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:50:20.797Z"
comments: [{"author":"main","ts":"2026-10-02T05:15:01.610Z","text":"TM-288 board review (approved by Ryan 2026-10-02): stale blocked-by link(s) to done task(s) removed (report §8)."},{"author":"main","ts":"2026-10-05T15:50:20.791Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/210 (independent post-merge review rv-gov: all ACs met; NUL case TM-428, cache order TM-445)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-216-1791214051757.log":{"source":null,"sha256":"f89116c5aaf1682a5829fdc58a8ae8123d5720ab74206c68a4706920ff3cb5dd","bytes":368,"at":"2026-10-05T15:27:31.757Z"}}
closed: "2026-10-05T15:27:32.148Z"
---

Operator-approved 2026-09-24. Item 1 review packet: requestReview (reviewer.mjs:780-803) writes beside the .patch: files.txt (git diff --name-status --stat base..rev), files/<path> (git show rev:path per changed file), task.md (tm show acceptance criteria + touches), checks.json (command, exit code, revision, log tail), checklist.md; packet_sha256 recorded in the request and verified in collectReview like patch_sha256 (:830). Item 3: per-consumer-repo checklist layered into the reviewer prompt (gateway: cd src && go test ./..., root go test ./cmd/... ./internal/..., gofmt, handbook check, web tests, SDK aliases, regenerated plugin.json, CHANGELOG/src/embedded_changelog.md sync, docs/TESTING.md for flakes); reviewer returns blocked when packet lacks check evidence. Item 4: reviewEligibility (:721) also requires checks.json records at the reviewed revision with exit 0 for every required check. cli.mjs reviewer request gains flags to pass check evidence. Depends on the findings/bugs task landing first (same file).