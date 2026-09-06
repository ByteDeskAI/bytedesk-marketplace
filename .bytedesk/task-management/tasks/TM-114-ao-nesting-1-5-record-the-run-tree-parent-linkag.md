---
id: "TM-114"
kind: "task"
status: "done"
created: "2026-09-06T22:54:51.245Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO nesting 1/5: record the run tree — parent linkage, spawn events, depth cap, stop cascade"
epic: "EP-016"
acceptance: [{"text":"A child run records its parent, and the parent journals run.spawned","done":true,"at":"2026-09-06T23:03:47.136Z"},{"text":"stop on a parent tears down its children; --no-cascade leaves them","done":true,"at":"2026-09-06T23:03:47.248Z"},{"text":"Depth beyond the cap and a self-referencing workflow are both refused by code","done":true,"at":"2026-09-06T23:03:47.356Z"}]
evidence: [".bytedesk/task-management/evidence/TM-114-lineage.mjs",".bytedesk/task-management/evidence/TM-114-topology-lineage.test.mjs"]
commits: ["eab5de6"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T23:03:47.707Z"
touches: ["agent-orchestration/tests/unit/topology-lineage.test.mjs","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/lineage.mjs"]
closed: "2026-09-06T23:03:47.703Z"
---

Step 1 of the approved plan (.bytedesk/task-management/plans/2026-09-06-nested-workflows-fan-out-and-the-templates-workf.md). No new spec surface — this makes the nesting that ALREADY happens observable and safe.

Nesting works de facto today: an agent that shells out to `ao-topology launch` creates a real child run and tmux session. Verified. But the child's run.json has no parent field, the parent's journal has no spawn event, stop leaves the child orphaned, and nothing caps depth or detects a cycle.

- run.json gains `parent`: {run_dir, run_id, agent_id, depth}, null at the root. Written in the run object at launch.mjs:510.
- Every agent's env (launch.mjs:380) gains AO_PARENT_RUN_DIR, AO_PARENT_AGENT_ID, AO_RUN_DEPTH — so a child launched by hand still records the link.
- Journal: run.spawned on the parent, run.child_exited on terminal state.
- --max-depth (default 3) -> TOPOLOGY_DEPTH_EXCEEDED; cycle detection over the ancestor chain -> TOPOLOGY_WORKFLOW_CYCLE.
- stop (cli.mjs:612) cascades to children; --no-cascade opts out.