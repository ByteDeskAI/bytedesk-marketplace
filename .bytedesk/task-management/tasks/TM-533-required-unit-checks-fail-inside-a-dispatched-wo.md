---
id: "TM-533"
kind: "task"
status: "open"
created: "2026-10-11T05:19:33.147Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Required unit checks fail inside a dispatched worker: governed-ownership tests see the worker's real process ancestry"
epic: "EP-029"
acceptance: [{"text":"Tests that exercise governed grants inject their caller identity (pids/dirs/start) and do not read the real ancestry or the canonical registry","done":false},{"text":"agent-orchestration and task-management test:unit pass when run inside a live dispatched worker (proof: a dispatched run's checks file)","done":false},{"text":"Production isWorkerCaller still consults the canonical registry and real ancestry (unchanged test)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-10-11T05:19:33.940Z"
priority: "high"
---

Reported by the TM-324 worker (84432a94), 2026-10-11. Running the config required_checks inside a dispatched worker fails agent-orchestration unit (10 tests) and task-management unit (41 tests); the same tests pass when the lead runs them. Every failure is the refusal 'a dispatched worker cannot grant or change governed task ownership' (task-management/lib/governance.mjs:8). Cause: isWorkerCaller (task-management/lib/worker-identity.mjs:150) walks the real ancestorPids() against registryDirs(), which always includes the canonical registry (line 51). The env -i allowlist from #254 strips env but cannot strip process ancestry, so the test process inherits the worker's identity. Effect: no worker can satisfy its own required checks, so faro sees them unsatisfied and every finish needs the lead to rerun them. Repro: inside any tm dispatch worker, run 'cd task-management && npm run -s test:unit' and look for the refusal. Keep the canonical registry check in production (it is a security property); fix it in the tests.