---
okf_version: "0.2"
---

# Knowledge Bundle

## (root)

* [L](/l.md) - L

## architecture

* [Gateway tab ids are server-minted](/architecture/gateway-tab-ids-are-server-minted.md) - The gateway mints tab ids and derives session names from them; req.Session was decoded then overwritten until TM-097 made the builder honour it, and prefix-matching sessions ARE discovered at startup
* [Task-management architecture](/architecture/task-management-architecture.md) - Markdown store, hooks, MCP, claims — work tracking twin of knowledge-management
* [The goal planner's governed-proposal boundary](/architecture/the-goal-planner-s-governed-proposal-boundary.md) - Why an agent cannot write to the board, and the four invariants that make that true

## decisions

* [Decision 2026-09-01](/decisions/decision-2026-09-01.md) - Agent-captured decision
* [Decision 2026-09-06](/decisions/decision-2026-09-06.md) - Agent-captured decision
* [The tmux topology layer is the authoritative orchestration layer](/decisions/topology-is-the-authoritative-orchestration-layer.md) - agent-orchestration ships two unrelated runtimes; topology wins for dispatched work and the agent hierarchy, the MCP broker is kept as an opt-in sandboxed backend, and tm owns the worktree
* [Use OKF for durable knowledge](/decisions/use-okf-for-durable-knowledge.md) - Adopt Open Knowledge Format v0.2 as on-disk contract for agent knowledge

