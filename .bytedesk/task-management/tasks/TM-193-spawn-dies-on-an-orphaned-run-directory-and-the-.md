---
id: "TM-193"
kind: "task"
status: "open"
created: "2026-09-12T07:20:37.966Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Spawn dies on an orphaned run directory, and the router picks a model the ACP agent does not advertise"
epic: "EP-021"
acceptance: [{"text":"A run directory without a snapshot is ignored or reconciled, and never fails an unrelated spawn; covered by a test","done":false},{"text":"A model the ACP agent does not advertise is refused during routing or reconciled at doctor time, not at execution","done":false},{"text":"Both cases carry a test using a fixture state root","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "9c583517-b11d-4a6e-bc61-2a8116384702"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-12T07:20:37.973Z"
---

Two defects hit while a gateway session verified run controls against real runs on 2026-09-12. Both are in agent-orchestration, not in the gateway.

1. AN ORPHANED RUN DIRECTORY BREAKS EVERY SPAWN. orchestration_spawn failed with AO_RUN_NOT_FOUND naming run_484f8ec2-7f76-4b61-ac8e-fe91f27b422d — a directory holding only session.json and a .sweep marker, no snapshot.json, left behind by an earlier sweep. The spawn had nothing to do with that run. Moving the directory out of <stateRoot>/runs made spawn work again immediately. A half-swept directory should be ignored or reconciled, never fatal to unrelated work; 1 of 117 run directories was enough to stop all spawning.

2. THE ROUTER SELECTS A MODEL ID THE AGENT REJECTS. A persistent-session research run routed to claude.opus-5 and failed with ACP_MODEL_UNSUPPORTED: 'Cannot apply --model "claude-opus-5": the ACP agent did not advertise that model. Available models: default, opus[1m], sonnet, haiku.' The model catalog and what the ACP agent advertises have drifted, so a route that looks eligible cannot execute. Either reconcile the catalog against the agent's advertised models at doctor time, or treat an unadvertised model as ineligible during routing so the fallback path is used instead of failing the run.

Context: the gateway now drives cancel, follow-up, decision and cleanup through the session seam, so these failures are visible to operators, not only to MCP callers.