---
name: agent-orchestrate
description: Delegate bounded work to Claude Code, Codex, Grok Build, or Kimi through the agent-orchestration MCP server. Use when this host (Claude, Codex, Grok, or Kimi) should spawn another catalog CLI, run competing model reviews, or coordinate parallel provider work.
user-invokable: true
argument-hint: "<task> [--providers claude,grok-build,kimi]"
---

# Agent Orchestrate

Use the bundled `orchestration_*` MCP tools. This host may be Claude Code, Codex, Grok Build, or Kimi
Code. Do not launch provider CLIs directly and do not claim that a native host subagent changes provider.

If the tools are missing, the current CLI is not wired as a host. Run `install-orchestration-host`
instead of shelling out to `claude`, `codex`, `grok`, or `kimi`.

## Process

1. Resolve the consumer repository or worktree to an explicit absolute path. Pass that path as
   `consumerCwd` to every consumer-grounded or mutating tool. Never infer it from the MCP server cwd.
2. If provider health is unknown, call `orchestration_capabilities` and `orchestration_doctor` before planning work.
3. Honor a provider the user named. Use `orchestration_route` only for a single-provider preview. Call `orchestration_plan`
   for architecture and every other multi-stage protocol so every provider route is visible.
4. Before each `orchestration_spawn`, state the exact task, expected result, provider, permission profile,
   timeout, session mode, and owned files or read-only boundary. Default to read-only.
5. For parallel work, spawn only disjoint scopes. Record each orchestration and execution ID.
6. Use `orchestration_events` or `orchestration_status` for progress and `orchestration_wait` for completion. Use `orchestration_send` only when
   the parent was explicitly read-only and persistent and its provider supports session loading;
   otherwise spawn a new scoped run. Do not poll aggressively.
7. If a provider requests approval, inspect it with `orchestration_decision_get`. Call `orchestration_decision_approve`
   only when the user or existing policy explicitly authorizes that exact action.
8. Cancel stalled or superseded work with `orchestration_cancel`. Use `orchestration_cleanup` only after results and
   evidence have been collected; cleanup permanently discards the terminal worktree and its patch.
9. Synthesize results by provider. Preserve disagreements, partial failures, verification gaps, and
   the difference between observed evidence and model opinion.

## Tool surface

- Discovery and routing: `orchestration_capabilities`, `orchestration_doctor`, `orchestration_route`, `orchestration_plan`
- Lifecycle: `orchestration_spawn`, `orchestration_send`, `orchestration_wait`, `orchestration_status`, `orchestration_list`, `orchestration_events`
- Control: `orchestration_cancel`, `orchestration_cleanup`
- Approval: `orchestration_decision_get`, `orchestration_decision_approve`

Provider IDs are `claude`, `codex`, `grok-build`, and `kimi`.

Routing policy defaults:

- Architecture: Claude Fable (Opus fallback) and OpenAI Sol in the max-effort adversarial protocol.
- Design: Claude Fable/Opus at high effort.
- Implementation: OpenAI Sol at high effort, raised to max for high/critical risk or explicitly set.
- Research: Grok Build when available.
- Large-context work: Kimi when available.
- Review: a provider family different from the originating implementation when possible.
