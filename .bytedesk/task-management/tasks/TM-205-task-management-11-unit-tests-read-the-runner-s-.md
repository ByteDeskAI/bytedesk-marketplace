---
id: "TM-205"
kind: "task"
status: "open"
created: "2026-09-14T01:01:18.681Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: 11 unit tests read the runner's live session, so the suite is red only inside a dispatched worker"
epic: "EP-021"
acceptance: [{"text":"the 11 named tests pass with TM_SESSION_ID, TM_ACTOR and TM_DISPATCH_* set in the environment, and still pass with them unset","done":false},{"text":"the fix is one shared mechanism (withSessionEnv or equivalent), not a per-file patch; every call site that reads a session id is audited, not only the 11 that happen to be red","done":false},{"text":"node --test task-management/tests/unit/*.test.mjs is 1506/1506 both inside a dispatched worker and in a bare shell","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/120"]
blockedBy: []
blocks: []
actor: "@pool"
session: "pool-tm-204"
updated: "2026-09-14T01:03:26.039Z"
labels: ["ready-for-agent"]
triagedBy: "auto"
---

Found while finishing TM-204 (2026-09-13). TM-204 fixed the tests that read the developer's live STORE. A second, distinct class remains: tests that read the runner's live SESSION.

Measured at 16804b6 + the TM-204 branch, ambient store = this repo's own:
- normal shell (TM_SESSION_ID / TM_ACTOR / TM_DISPATCH_* unset): 1506 pass / 0 fail, exit 0
- inside a dispatched pool worker (TM_SESSION_ID=pool-tm-204, TM_ACTOR=pool, TM_DISPATCH_WORKER=1): 1495 pass / 11 fail, exit 1

The 11, by file:
- actor.test.mjs 'infers an anonymous subagent only when explicitly asked to' — asserts a match and gets the literal ambient session id 'pool-tm-204'
- claims: 'refuses a task another live session holds', 'names steal in the refusal', 'leaves no status change behind when it refuses', 'takes it with steal, and says whose it was', 'records claim_stolen'
- mcp: 'tm_task_update start', 'tm_claim' / 'refuses a live foreign claim', 'tm_worktree new claims and provisions...'
- handoff: 'tells the worker to commit, push its own branch, and open a PR titled with the TM key', 'names a generic tm/ branch when the task records none'
- events: 'the event log's session column is populated, having been null on every event ever written'

tests/unit/helpers.mjs already has withSessionEnv(), written for exactly this and documented with the same story ('the test then passed in CI and in a bare shell, and failed only for whoever ran it from inside Claude Code'). These 11 call sites do not use it. The likely fix is to route them through it — after checking whether one shared helper covers all five files, rather than patching one and leaving its siblings.

Why it matters now: the pool dispatches workers with these vars set, so a dispatched worker that runs the suite as its own gate sees 11 red tests it did not cause, and a lead running the same commit in a terminal sees green. That is the same 'the suite reports the machine' failure TM-204 fixed one half of.