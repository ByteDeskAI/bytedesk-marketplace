---
id: "TM-262"
kind: "task"
status: "open"
created: "2026-09-27T03:47:29.892Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: reviewer readiness test is timing-flaky on CI (500ms probe window)"
epic: "EP-024"
acceptance: [{"text":"The test does not depend on wall-clock under 500ms (inject a clock or raise the window with a deterministic ack)","done":false},{"text":"20 consecutive CI-equivalent runs pass","done":false}]
evidence: [".bytedesk/task-management/evidence/TM-288-board-review.md"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "b41d685d-7094-4957-80a5-950b76fb0467"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["wontfix"]
triagedBy: "human"
updated: "2026-10-02T05:15:44.660Z"
links: [{"type":"duplicates","id":"TM-254"}]
comments: [{"author":"main","ts":"2026-10-02T05:13:13.325Z","text":"TM-288 board review (approved by Ryan 2026-10-02): duplicate of TM-254 (same flaky test, topology-reviewer.test.mjs:38). The CI diagnosis (run 36291669173) was copied into TM-254 as its AC1 cause."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-288-board-review.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-288-board-review.md","sha256":"ed7f9cfbae92b509e64cae65512005370365914d8cf8db10ab77b761d76619df","bytes":8836,"at":"2026-10-02T05:13:13.929Z"}}
---

tests/unit/topology-reviewer.test.mjs:38 'alive reviewer is unavailable without nonce; only current reviewer can acknowledge' failed on PR 134 CI run 36291669173 (job 108542811729): reviewerProbeReady with timeoutMs 500 returned false; the test took 1488ms. The rerun of the same commit 3ef2263 passed. TM-243 does not touch reviewer code or this test.