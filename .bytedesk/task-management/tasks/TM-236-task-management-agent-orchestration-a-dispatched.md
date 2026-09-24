---
id: "TM-236"
kind: "task"
status: "blocked"
created: "2026-09-24T22:56:22.726Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management + agent-orchestration: a dispatched worker reads its own worker-bound record as another session and exits"
epic: "EP-021"
acceptance: [{"text":"The dispatched worker's environment carries its own identity (tmux session name and pane id, or the dispatch run id), and the handoff states literally: you are the bound worker for <id>; a worker-bound or dispatched record naming this session is you.","done":false},{"text":"Any tm or ao-topology surface a worker reads to decide whether the task is already being worked (tm show, the worker-bound event, governance state) marks the entry that matches the caller's own session, pane or pid as self, so it does not count as a conflicting worker.","done":false},{"text":"A test launches a worker whose own identity appears in the worker-bound record and asserts it is reported as self, not as a duplicate; a second test with a different live pid still reports the conflict.","done":false},{"text":"CHANGELOG entries in both plugins name this incident (gateway TM-455).","done":false}]
evidence: []
commits: []
blockedBy: ["TM-235"]
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-09-24T22:56:23.154Z"
priority: "high"
---

Reported by gateway lead d60f0608 on 2026-09-24. Gateway TM-455 was started with 'ao-topology manage start-worker --backend tmux' (TM-218 path: tm dispatch, then bindTaskWorker writes a worker-bound event, agent-orchestration/topology/lib/management.mjs:247). The worker (tmux session tm-TM-455, pane %879, pid 1607748) read that record and concluded, verbatim from its transcript: 'A worker session (tm-TM-455, pid 1607748, running claude) is already actively working this task ... I'm a separate session in the same worktree — duplicating work here would conflict.' pid 1607748 was itself. It exited without working; tm recorded 'worker exited without closing'. Intermittent: TM-454, TM-217 and TM-234 started the same way worked, because those workers did not consult the bound record. The environment already marks the worker (TM_DISPATCH_WORKER=1, TM_DISPATCH_TASK, TM_DISPATCH_BRANCH at task-management/lib/dispatch/tmux.mjs:68), but it carries no session, pane or pid identity, and the rendered handoff (lib/render.mjs) never says the bound worker is the reader.