---
id: "TM-511"
kind: "task"
status: "blocked"
created: "2026-10-09T05:06:55.610Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Required unit checks fail inside a dispatched worker: TM_DISPATCH_*, TM_ROOT, TM_ACTOR leak into the suites"
epic: "EP-029"
acceptance: [{"text":"Both unit required_checks pass when run verbatim from a dispatched worker session","done":false},{"text":"A test or the check runner strips the dispatch-worker env so the checks measure the commit, not the session","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/250","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/254","bccd734d"]
blockedBy: ["TM-516"]
blocks: []
actor: "@main"
session: "fd2b831f"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
filedBy: {"board":"bytedeskai/bytedesk-marketplace","agent":"a972d6cf","task":"TM-478"}
labels: ["decision:intake","needs-triage"]
triagedBy: "auto"
triageMissing: ["label decision:intake"]
updated: "2026-10-09T07:21:52.404Z"
comments: [{"author":"main","ts":"2026-10-09T05:30:25.713Z","text":"Interim fix landed: #248 (8a4e1090) unsets TM_DISPATCH_WORKER, TM_DISPATCH_TASK, TM_ACTOR, AO_CONSUMER and AO_TRANSPORT in the required checks, and #250 (f432484e) adds TM_ROOT. Measured on main: tm unit 1677/0 with them unset, 1671/6 with TM_DISPATCH_* set. Left open for the structural fix, TM-516 (host-side env allowlist outside the pane tree)."},{"author":"@main","ts":"2026-10-09T05:38:51.676Z","text":"Seen again in TM-513 at ea9760f: TM_SESSION_ID also leaks. With TM_SESSION_ID=<lead id> the configured 'task-management: unit' check fails 9/1677 (actor.test.mjs:77, mcp-claims.test.mjs:61-93,144; actor resolves to 'fd2b831f'); adding -u TM_SESSION_ID gives 1677/1677. Logs /tmp/tm513-checks/task-management__unit{,.rerun}.log."},{"author":"main","ts":"2026-10-09T05:54:36.568Z","text":"PR #254 merged (bccd734d): the three test checks now run under env -i with PATH, HOME, LANG, USER and TMPDIR only. Proven: with TM_SESSION_ID, TM_DISPATCH_*, TM_ROOT, TM_ACTOR and AO_AGENT_ID injected, tm unit 1678/0 and plugin-rsync 33/0. This supersedes the #248/#250 unset lists. Still open for TM-516 (host runner outside the pane tree)."},{"author":"main","ts":"2026-10-09T07:21:52.396Z","text":"New shape (TM-521 worker, 2026-10-09): even under the env -i allowlist (#254), task-management unit fails 41 tests on clean main 1c497151 when run INSIDE a dispatched worker session (1660 pass); it passes 1678/0 from the lead's session. env -i keeps PATH, and a worker's PATH likely contains guard shims for git and gh, so tests that shell out to git get refused. To confirm, compare PATH inside a worker with the lead's. Fix candidates: pin PATH in the allowlist to system dirs plus node's dir, or run checks host-side outside the worker (TM-516)."}]
---

The management.required_checks entries 'agent-orchestration: unit' and 'task-management: unit' in .bytedesk/agent-orchestration/config.json unset TMUX/AO_* but not TM_DISPATCH_WORKER, TM_DISPATCH_TASK, TM_DISPATCH_BRANCH, TM_DISPATCH_INTEGRATION_BRANCH, TM_ROOT, TM_ACTOR, TM_SESSION_ID, AO_SESSION_NO_OPEN, AO_TOPOLOGY_BIN. Run from a dispatched worker session (where the checks are meant to be run before a finish report), agent-orchestration unit fails 10 tests (e.g. 'A dispatched worker session (TM_DISPATCH_WORKER) cannot read every agent's mail in the workflow console', 'TM-1: workers finish at ready-for-review...') and task-management unit fails too. Seen on TM-478 at e9cdc90d: as configured ao-unit 1, tm-unit 1; with those vars also unset 1296/1296 and 1675/1675 pass; GitHub CI green at the same commit. Repro: in any tm-dispatched worker, run the two check argv entries verbatim.