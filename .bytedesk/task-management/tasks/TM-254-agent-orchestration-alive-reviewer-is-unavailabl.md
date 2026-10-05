---
id: "TM-254"
kind: "task"
status: "open"
created: "2026-09-25T20:28:46.694Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: 'alive reviewer is unavailable without nonce' is flaky in CI"
epic: "EP-019"
acceptance: [{"text":"The cause is identified by recording the actual error code the assertion received on a failing run, not inferred.","done":false},{"text":"The test passes 20 consecutive runs under CI-like conditions (node --test --test-concurrency=1, TMUX unset), with the loop's pass count printed.","done":false},{"text":"If the fix is a timing change, the test no longer depends on wall-clock sleeps shorter than the operation it waits on.","done":false}]
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
updated: "2026-10-02T05:13:13.050Z"
priority: "medium"
comments: [{"author":"main","ts":"2026-10-02T05:13:12.557Z","text":"TM-288 (approved by Ryan 2026-10-02): TM-262 is a duplicate of this task (same flaky test, topology-reviewer.test.mjs:38). Its CI diagnosis, recorded here as the AC1 cause candidate: tests/unit/topology-reviewer.test.mjs:38 'alive reviewer is unavailable without nonce; only current reviewer can acknowledge' failed on PR 134 CI run 36291669173 (job 108542811729): reviewerProbeReady with timeoutMs 500 returned false; the test took 1488ms. The rerun of the same commit 3ef2263 passed."}]
links: [{"type":"duplicated by","id":"TM-262"}]
---

Seen 2026-09-25 on PRs 123 and 124: the unit-build-contracts job passed and failed at the SAME head commit in its push and pull_request runs, in opposite directions (92bb318: push pass, PR fail, run 36172024251; f69a7f2: push fail run 36171352436, PR pass). Failing assertion: tests/unit/topology-reviewer.test.mjs, 'alive reviewer is unavailable without nonce; only current reviewer can acknowledge' (strictEqual on an error code, around lines 38 and 46). The test exists on main. Workers reported 0 failures locally with TMUX unset. Likely a timing or ordering dependency; the red run also fails test-build-install through STRICT_RESULT.