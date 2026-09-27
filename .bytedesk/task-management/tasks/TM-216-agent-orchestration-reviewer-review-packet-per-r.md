---
id: "TM-216"
kind: "task"
status: "open"
created: "2026-09-24T17:16:16.508Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: review packet, per-repo checklist, revision-bound check evidence"
epic: "EP-021"
acceptance: [{"text":"Packet written and hashed; a changed packet refuses collection; unit tests","done":false},{"text":"Per-repo checklist loaded from the consumer repo and injected; missing check evidence yields blocked; unit tests","done":false},{"text":"Eligibility refuses checks recorded at another revision or with nonzero exit; unit tests","done":false},{"text":"Reviewer stays unable to write or execute; unit suite passes; CHANGELOG entry","done":false}]
evidence: []
commits: []
blockedBy: ["TM-215"]
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T21:34:48.318Z"
---

Operator-approved 2026-09-24. Item 1 review packet: requestReview (reviewer.mjs:780-803) writes beside the .patch: files.txt (git diff --name-status --stat base..rev), files/<path> (git show rev:path per changed file), task.md (tm show acceptance criteria + touches), checks.json (command, exit code, revision, log tail), checklist.md; packet_sha256 recorded in the request and verified in collectReview like patch_sha256 (:830). Item 3: per-consumer-repo checklist layered into the reviewer prompt (gateway: cd src && go test ./..., root go test ./cmd/... ./internal/..., gofmt, handbook check, web tests, SDK aliases, regenerated plugin.json, CHANGELOG/src/embedded_changelog.md sync, docs/TESTING.md for flakes); reviewer returns blocked when packet lacks check evidence. Item 4: reviewEligibility (:721) also requires checks.json records at the reviewed revision with exit 0 for every required check. cli.mjs reviewer request gains flags to pass check evidence. Depends on the findings/bugs task landing first (same file).