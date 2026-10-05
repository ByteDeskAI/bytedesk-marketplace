---
okf_version: "0.2"
---

# Knowledge Bundle

## (root)

* [L](/l.md) - L

## architecture

* [Gateway tab ids are server-minted](/architecture/gateway-tab-ids-are-server-minted.md) - The gateway mints tab ids and derives session names from them; req.Session was decoded then overwritten until TM-097 made the builder honour it, and prefix-matching sessions ARE discovered at startup
* [task-management and agent-orchestration stay independent of each other](/architecture/task-management-and-agent-orchestration-stay-ind.md) - Each plugin works with the other absent: no cross imports, no manifest dependency, capability-check then skip silently (Ryan, 2026-09-25)
* [Task-management architecture](/architecture/task-management-architecture.md) - Markdown store, hooks, MCP, claims — work tracking twin of knowledge-management
* [The goal planner's governed-proposal boundary](/architecture/the-goal-planner-s-governed-proposal-boundary.md) - Why an agent cannot write to the board, and the four invariants that make that true

## decisions

* [Decision 2026-09-01](/decisions/decision-2026-09-01.md) - Agent-captured decision
* [Decision 2026-09-06](/decisions/decision-2026-09-06-2.md) - Agent-captured decision
* [Decision 2026-09-06](/decisions/decision-2026-09-06.md) - Agent-captured decision
* [Decision 2026-09-07](/decisions/decision-2026-09-07-2.md) - Agent-captured decision
* [Decision 2026-09-07](/decisions/decision-2026-09-07.md) - Agent-captured decision
* [Decision 2026-09-09](/decisions/decision-2026-09-09-2.md) - Agent-captured decision
* [Decision 2026-09-09](/decisions/decision-2026-09-09-3.md) - Agent-captured decision
* [Decision 2026-09-09](/decisions/decision-2026-09-09.md) - Agent-captured decision
* [Decision 2026-09-11](/decisions/decision-2026-09-11-2.md) - Agent-captured decision
* [Decision 2026-09-11](/decisions/decision-2026-09-11-3.md) - Agent-captured decision
* [Decision 2026-09-11](/decisions/decision-2026-09-11-4.md) - Agent-captured decision
* [Decision 2026-09-11](/decisions/decision-2026-09-11.md) - Agent-captured decision
* [Decision 2026-09-13](/decisions/decision-2026-09-13-2.md) - Agent-captured decision
* [Decision 2026-09-13](/decisions/decision-2026-09-13-3.md) - Agent-captured decision
* [Decision 2026-09-13](/decisions/decision-2026-09-13.md) - Agent-captured decision
* [Decision 2026-09-25](/decisions/decision-2026-09-25-2.md) - Agent-captured decision
* [Decision 2026-09-25](/decisions/decision-2026-09-25-3.md) - Agent-captured decision
* [Decision 2026-09-25](/decisions/decision-2026-09-25-4.md) - Agent-captured decision
* [Decision 2026-09-25](/decisions/decision-2026-09-25.md) - Agent-captured decision
* [Decision 2026-09-27](/decisions/decision-2026-09-27-2.md) - Agent-captured decision
* [Decision 2026-09-27](/decisions/decision-2026-09-27.md) - Agent-captured decision
* [Decision 2026-09-30](/decisions/decision-2026-09-30-2.md) - Agent-captured decision
* [Decision 2026-09-30](/decisions/decision-2026-09-30.md) - Agent-captured decision
* [Decision 2026-10-01](/decisions/decision-2026-10-01-2.md) - Agent-captured decision
* [Decision 2026-10-01](/decisions/decision-2026-10-01-3.md) - Agent-captured decision
* [Decision 2026-10-01](/decisions/decision-2026-10-01.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-10.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-2.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-3.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-4.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-5.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-6.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-7.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-8.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02-9.md) - Agent-captured decision
* [Decision 2026-10-02](/decisions/decision-2026-10-02.md) - Agent-captured decision
* [Decision 2026-10-03](/decisions/decision-2026-10-03-2.md) - Agent-captured decision
* [Decision 2026-10-03](/decisions/decision-2026-10-03-3.md) - Agent-captured decision
* [Decision 2026-10-03](/decisions/decision-2026-10-03-4.md) - Agent-captured decision
* [Decision 2026-10-03](/decisions/decision-2026-10-03-5.md) - Agent-captured decision
* [Decision 2026-10-03](/decisions/decision-2026-10-03.md) - Agent-captured decision
* [Decision 2026-10-04](/decisions/decision-2026-10-04.md) - Agent-captured decision
* [The tmux topology layer is the authoritative orchestration layer](/decisions/topology-is-the-authoritative-orchestration-layer.md) - agent-orchestration ships two unrelated runtimes; topology wins for dispatched work and the agent hierarchy, the MCP broker is kept as an opt-in sandboxed backend, and tm owns the worktree
* [Use OKF for durable knowledge](/decisions/use-okf-for-durable-knowledge.md) - Adopt Open Knowledge Format v0.2 as on-disk contract for agent knowledge

## runbooks

* [ao rollout lessons: managed services, naming, multi-host installs (2026-10-01/02)](/runbooks/ao-rollout-lessons-managed-services-naming-multi.md) - Problems hit while moving agent-orchestration onto process-compose services and ADR-0030 naming, each with its fix or tracking task; read before changing ao setup, services or tests

