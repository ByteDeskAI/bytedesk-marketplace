---
id: "TM-198"
kind: "task"
status: "done"
created: "2026-09-13T20:15:03.433Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: topology dispatch fails — the spec's agent cwd escapes the dispatched worktree"
epic: "EP-021"
acceptance: [{"text":"tm dispatch --backend topology launches a worker for a task in a provisioned worktree, with no TOPOLOGY_PATH_ESCAPES_REPO","done":true,"at":"2026-09-13T21:52:48.594Z"},{"text":"the fix states which side owns the definition of the consumer, and a test covers a dispatch whose consumer is a linked worktree","done":true,"at":"2026-09-13T21:52:48.725Z"},{"text":"a backend that refuses at launch falls through to the next configured backend instead of counting as a pool failure, or the reason says explicitly why falling through is wrong","done":true,"at":"2026-09-13T21:52:48.859Z"},{"text":"tests/test-pool.sh or a unit test reproduces the failure against the pre-fix code","done":true,"at":"2026-09-13T21:52:48.981Z"}]
evidence: [".bytedesk/task-management/evidence/TM-198-topology-dispatch-worktree.md"]
commits: ["815fc17","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/117","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/119","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/120"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-198"
branch: "tm/TM-198-task-management-topology-dispatch-fails-the-spec"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-198-task-management-topology-dispatch-fails-the-spec"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-14T01:03:26.006Z"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-198","session":"pool-tm-198","at":"2026-09-13T21:30:19.047Z"}
evidenceSources: {".bytedesk/task-management/evidence/TM-198-topology-dispatch-worktree.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-198-task-management-topology-dispatch-fails-the-spec/.bytedesk/task-management/evidence/TM-198-topology-dispatch-worktree.md","sha256":"f5863aa172cfc1be65b9a76ed55e4d89889ae38a4434a6c39759b7f44641dfca","bytes":7558,"at":"2026-09-13T21:52:52.157Z"}}
closed: "2026-09-13T21:54:15.048Z"
---

First live run of the pool (2026-09-13) failed every dispatch and tripped the brake after three. ao-topology refuses the spec: TOPOLOGY_PATH_ESCAPES_REPO: agents.worker.cwd resolves to <main checkout>/.bytedesk/agent-orchestration/agents/<id>, which is outside this repository (<the tm worktree>). The cause is a disagreement between the two plugins about which checkout is 'the repository': tm dispatch passes --consumer <the worktree it provisioned for the task> (lib/dispatch/topology.mjs), while agent-orchestration resolves its agent library against the MAIN checkout (topology/lib/agents.mjs libraryConsumer takes the first entry of git worktree list). The agent directory is therefore inside the repo but outside the consumer, and ao rejects it. Options to weigh: pass the main checkout as consumer and the worktree another way; copy or point the agent dir per-dispatch; or have ao accept a consumer that is a linked worktree of the same repository (its own repoid canonicalises worktrees to the main checkout already). Until this is fixed the topology backend cannot dispatch, and it is first in the default backend order, so the pool fails rather than falling through to tmux.