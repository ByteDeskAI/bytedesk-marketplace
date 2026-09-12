---
id: "TM-176"
kind: "task"
status: "done"
created: "2026-09-11T19:43:00.093Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: compute agent readiness and sync triage labels automatically"
epic: "EP-021"
acceptance: [{"text":"agentReadiness is the single implementation, exported from lib/completeness.mjs, with unit tests for every rule","done":true,"at":"2026-09-11T20:29:14.946Z"},{"text":"creating a complete task labels it ready-for-agent with triagedBy auto; an incomplete one gets needs-triage and triageMissing naming what is missing","done":true,"at":"2026-09-11T20:29:15.136Z"},{"text":"a triage label set by a person (tm label, tm_label, HTTP) survives later edits; setting it clears triagedBy","done":true,"at":"2026-09-11T20:29:15.339Z"},{"text":"the sync happens inside the same store write; editing an unrelated field logs no extra label event","done":true,"at":"2026-09-11T20:29:15.531Z"},{"text":"dispatch.autoReady off disables the sync; the setting is in the settings catalog","done":true,"at":"2026-09-11T20:29:15.713Z"},{"text":"tm task new --human creates the task labelled ready-for-human","done":true,"at":"2026-09-11T20:29:15.890Z"},{"text":"tm triage --dry-run lists what would change and writes nothing; tm triage --all applies it","done":true,"at":"2026-09-11T20:29:16.038Z"},{"text":"graft callers confirm CLI, MCP and HTTP task writes all reach the funnel; node --test task-management/tests/unit exits 0","done":true,"at":"2026-09-11T20:29:16.177Z"}]
evidence: [".bytedesk/task-management/evidence/TM-176-VERIFY.md"]
commits: ["cc7b709"]
blockedBy: []
blocks: ["TM-178"]
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T20:46:01.100Z"
comments: [{"author":"main","ts":"2026-09-11T19:47:50.863Z","text":"delegated 2026-09-11 by lead session c3738e82 to Agent-tool worker 'w-readiness' in an isolated worktree; work is live, not abandoned. Lead reviews and merges; do not park or restart unless that worker is confirmed gone. Stop gate cannot see Agent-tool delegation (CAP-0003)."},{"author":"main","ts":"2026-09-11T20:29:16.471Z","text":"merged to main as cc7b709 (worker commits 4026f69, 4a3f6a8, merge 8b2f289); lead re-ran unit 1444/1444 and run-tests.sh contract all green, exit 0, clean tree; merged tree identical to 8b2f289. Person's triage decision stamped triagedBy human (lead review fix)."}]
touches: [".claude/worktrees/agent-a1d73d7bf5b881958/task-management/lib/issue.mjs",".claude/worktrees/agent-a1d73d7bf5b881958/task-management/lib/store.mjs"]
parkedReason: "not abandoned: Agent-tool worker w-readiness is live (ListAgents: running) applying the review fix and merging main on branch worktree-agent-a1d73d7bf5b881958. Parked only to stop the Stop gate re-blocking every turn: its once-only release state (lastStopBlock) is store-wide and other sessions' stops clear it. Lead resumes with tm start TM-176 when the worker reports."
labels: ["ready-for-agent"]
triagedBy: "auto"
evidenceSources: {".bytedesk/task-management/evidence/TM-176-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-176-VERIFY.md","sha256":"356176c13c9106c7bf2e368bc09d1490db55c7258ca02763d66ccfb07220551f","bytes":4591,"at":"2026-09-11T20:29:16.333Z"}}
closed: "2026-09-11T20:29:16.640Z"
---

Today ready-for-agent is applied only by hand and nothing checks a task is complete enough. Add agentReadiness(task, cfg) -> {ready, missing[]} to lib/completeness.mjs (dependency-free, so store.mjs can use it; issue.mjs imports store.mjs, never the reverse, store.mjs:1238-1241). Move TRIAGE_LABELS and DECISION_KIND there; issue.mjs re-exports. Ready = requireOnStart fields present, epic when requireEpic, none of ready-for-human/needs-info/wontfix/human-gate, none of decision:interview|prototype|unblock|map (research allowed). Status and deps excluded. In store create/update, for unresolved tasks with dispatch.autoReady 'label' (default), merge the triage label into the same write: ready -> ready-for-agent, else needs-triage + triageMissing; stamp triagedBy: auto. A human-set triage label is never overridden; issue.mjs labels() clears triagedBy on a human write. Add tm task new --human and tm triage [--all] [--dry-run]. Decision: auto-label with human veto (Ryan, 2026-09-11).