---
id: "TM-193"
kind: "task"
status: "done"
created: "2026-09-12T07:20:37.966Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Spawn dies on an orphaned run directory, and the router picks a model the ACP agent does not advertise"
epic: "EP-021"
acceptance: [{"text":"A run directory without a snapshot is ignored or reconciled, and never fails an unrelated spawn; covered by a test","done":true,"at":"2026-09-13T21:42:03.801Z"},{"text":"A model the ACP agent does not advertise is refused during routing or reconciled at doctor time, not at execution","done":true,"at":"2026-09-13T21:42:03.967Z"},{"text":"Both cases carry a test using a fixture state root","done":true,"at":"2026-09-13T21:42:04.114Z"}]
evidence: [".bytedesk/task-management/evidence/TM-193-VERIFY.md"]
commits: ["082c7a7","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/116","acb5dd4","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/119"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-193"
branch: "tm/TM-193-spawn-dies-on-an-orphaned-run-directory-and-the-"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-193-spawn-dies-on-an-orphaned-run-directory-and-the-"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-13T22:07:22.127Z"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-193","session":"pool-tm-193","at":"2026-09-13T21:30:18.256Z"}
touches: ["agent-orchestration/src/runtime/acpx-driver.mjs","agent-orchestration/src/service.mjs","agent-orchestration/src/state/store.mjs"]
evidenceSources: {".bytedesk/task-management/evidence/TM-193-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-193-spawn-dies-on-an-orphaned-run-directory-and-the-/.bytedesk/task-management/evidence/TM-193-VERIFY.md","sha256":"d8c4be30281a6f9ec61fd81a7cad29efb7eda1c67e7a17aa96aaa504e616950a","bytes":5038,"at":"2026-09-13T21:42:04.258Z"}}
comments: [{"author":"@pool","ts":"2026-09-13T21:43:18.358Z","text":"PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/116 on branch tm/TM-193-spawn-dies-on-an-orphaned-run-directory-and-the-. Follow-up TM-203 filed for the Claude catalog drift the fix now makes visible."}]
closed: "2026-09-13T21:43:18.517Z"
---

Two defects hit while a gateway session verified run controls against real runs on 2026-09-12. Both are in agent-orchestration, not in the gateway.

1. AN ORPHANED RUN DIRECTORY BREAKS EVERY SPAWN. orchestration_spawn failed with AO_RUN_NOT_FOUND naming run_484f8ec2-7f76-4b61-ac8e-fe91f27b422d — a directory holding only session.json and a .sweep marker, no snapshot.json, left behind by an earlier sweep. The spawn had nothing to do with that run. Moving the directory out of <stateRoot>/runs made spawn work again immediately. A half-swept directory should be ignored or reconciled, never fatal to unrelated work; 1 of 117 run directories was enough to stop all spawning.

2. THE ROUTER SELECTS A MODEL ID THE AGENT REJECTS. A persistent-session research run routed to claude.opus-5 and failed with ACP_MODEL_UNSUPPORTED: 'Cannot apply --model "claude-opus-5": the ACP agent did not advertise that model. Available models: default, opus[1m], sonnet, haiku.' The model catalog and what the ACP agent advertises have drifted, so a route that looks eligible cannot execute. Either reconcile the catalog against the agent's advertised models at doctor time, or treat an unadvertised model as ineligible during routing so the fallback path is used instead of failing the run.

Context: the gateway now drives cancel, follow-up, decision and cleanup through the session seam, so these failures are visible to operators, not only to MCP callers.