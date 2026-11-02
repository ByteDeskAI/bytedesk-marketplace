---
id: "TM-236"
kind: "task"
status: "done"
created: "2026-09-24T22:56:22.726Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management + agent-orchestration: a dispatched worker reads its own worker-bound record as another session and exits"
epic: "EP-021"
acceptance: [{"text":"The dispatched worker's environment carries its own identity (tmux session name and pane id, or the dispatch run id), and the handoff states literally: you are the bound worker for <id>; a worker-bound or dispatched record naming this session is you.","done":true,"at":"2026-09-25T01:19:53.992Z"},{"text":"Any tm or ao-topology surface a worker reads to decide whether the task is already being worked (tm show, the worker-bound event, governance state) marks the entry that matches the caller's own session, pane or pid as self, so it does not count as a conflicting worker.","done":true,"at":"2026-09-25T01:19:54.095Z"},{"text":"A test launches a worker whose own identity appears in the worker-bound record and asserts it is reported as self, not as a duplicate; a second test with a different live pid still reports the conflict.","done":true,"at":"2026-09-25T01:19:54.194Z"},{"text":"CHANGELOG entries in both plugins name this incident (gateway TM-455).","done":true,"at":"2026-09-25T01:19:54.284Z"},{"text":"Plugin independence (Ryan, 2026-09-25): task-management and agent-orchestration each work with the other absent. No import or require crosses the boundary and no manifest dependency is declared; a call into the other plugin first capability-checks it (the tm binary as at agent-orchestration management.mjs:50, or the ao-topology binary as at task-management hostcaps.mjs) and skips silently when it is missing, without failing or blocking the rest of the operation. A test runs each side with the other plugin absent.","done":true,"at":"2026-09-25T17:57:56.239Z"}]
evidence: [".bytedesk/task-management/evidence/TM-236-VERIFY.md"]
commits: ["7037f98","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/127","fde2dcf"]
blockedBy: ["TM-235"]
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "tm/TM-236-task-management-agent-orchestration-a-dispatched"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-236-task-management-agent-orchestration-a-dispatched"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-09-25T17:57:57.254Z"
priority: "high"
integrationBranch: "main"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-236","session":"40645e47-066b-4937-abc2-55d42e9ea247","at":"2026-09-25T17:52:31.778Z"}
touches: ["task-management/lib/dispatch/self.mjs","task-management/tests/unit/dispatch-self.test.mjs"]
evidenceSources: {".bytedesk/task-management/evidence/TM-236-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-236-task-management-agent-orchestration-a-dispatched/.bytedesk/task-management/evidence/TM-236-VERIFY.md","sha256":"5be0afb0595b318cc1efa5799ca49ac03221018eb29da699a67708649b133b0e","bytes":7056,"at":"2026-09-25T17:57:56.569Z"}}
comments: [{"author":"@main","ts":"2026-09-25T01:20:27.273Z","text":"PR: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/127 (commit 7037f98 on tm/TM-236-task-management-agent-orchestration-a-dispatched)"},{"author":"main","ts":"2026-09-25T17:52:23.027Z","text":"CI on PR 127 fails (unit-build-contracts, and test-build-install via STRICT_RESULT failure): the committed agent-orchestration/dist bundle does not match a fresh build. The build diff shows new reviewer constants and a different sourceFingerprint. Fix on the same branch: rebuild dist in the task worktree (npm run -s build in agent-orchestration), confirm 'npm run -s build:check' exits 0, commit and push. Note from .claude/rules/verification-that-can-fail.md rule 2: a worktree with a symlinked node_modules can bake different paths into the bundle; build with a real install if build:check differs between worktree and CI."},{"author":"@main","ts":"2026-09-25T17:57:56.865Z","text":"fde2dcf: criterion 5 (plugin independence) — ao manage status skips tm when absent; tests each side with the other absent. PR #127 updated."}]
knowledge: ["/architecture/task-management-and-agent-orchestration-stay-ind.md"]
reopenedReason: "PR 127 CI fails: committed agent-orchestration/dist does not match a fresh build. Rebuild, verify build:check, push to the same branch."
closed: "2026-09-25T17:57:57.246Z"
---

Reported by gateway lead d60f0608 on 2026-09-24. Gateway TM-455 was started with 'ao-topology manage start-worker --backend tmux' (TM-218 path: tm dispatch, then bindTaskWorker writes a worker-bound event, agent-orchestration/topology/lib/management.mjs:247). The worker (tmux session tm-TM-455, pane %879, pid 1607748) read that record and concluded, verbatim from its transcript: 'A worker session (tm-TM-455, pid 1607748, running claude) is already actively working this task ... I'm a separate session in the same worktree — duplicating work here would conflict.' pid 1607748 was itself. It exited without working; tm recorded 'worker exited without closing'. Intermittent: TM-454, TM-217 and TM-234 started the same way worked, because those workers did not consult the bound record. The environment already marks the worker (TM_DISPATCH_WORKER=1, TM_DISPATCH_TASK, TM_DISPATCH_BRANCH at task-management/lib/dispatch/tmux.mjs:68), but it carries no session, pane or pid identity, and the rendered handoff (lib/render.mjs) never says the bound worker is the reader.