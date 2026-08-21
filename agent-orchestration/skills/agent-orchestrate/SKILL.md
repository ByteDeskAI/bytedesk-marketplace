---
name: agent-orchestrate
description: Delegate bounded work to Claude Code, Codex, Grok Build, or Kimi through the agent-orchestration MCP server. Use when the user asks for cross-provider agents, competing model reviews, external subagents, parallel provider work, or provider-attributed synthesis.
user-invokable: true
argument-hint: "<task> [--providers claude,grok-build,kimi]"
---

# Agent Orchestrate

Use the bundled `ao_*` MCP tools. Do not launch provider CLIs directly and do not claim that a native
Claude or Codex subagent changes provider.

## Process

1. Resolve the consumer repository or worktree to an explicit absolute path. Pass that path as
   `consumerCwd` to every consumer-grounded or mutating tool. Never infer it from the MCP server cwd.
2. If provider health is unknown, call `ao_capabilities` and `ao_doctor` before planning work.
3. Honor a provider the user named. Use `ao_route` only for a single-provider preview. Call `ao_plan`
   for architecture and every other multi-stage protocol so every provider route is visible.
4. Before each `ao_spawn`, state the exact task, expected result, provider, permission profile,
   timeout, session mode, and owned files or read-only boundary. Default to read-only.
5. For parallel work, spawn only disjoint scopes. Record each orchestration and execution ID.
6. Use `ao_events` or `ao_status` for progress and `ao_wait` for completion. Use `ao_send` only when
   the parent was explicitly read-only and persistent and its provider supports session loading;
   otherwise spawn a new scoped run. Do not poll aggressively.
7. If a provider requests approval, inspect it with `ao_decision_get`. Call `ao_decision_approve`
   only when the user or existing policy explicitly authorizes that exact action.
8. Cancel stalled or superseded work with `ao_cancel`. Use `ao_cleanup` only after results and
   evidence have been collected; cleanup permanently discards the terminal worktree and its patch.
9. Synthesize results by provider. Preserve disagreements, partial failures, verification gaps, and
   the difference between observed evidence and model opinion.

## Tool surface

- Discovery and routing: `ao_capabilities`, `ao_doctor`, `ao_route`, `ao_plan`
- Lifecycle: `ao_spawn`, `ao_send`, `ao_wait`, `ao_status`, `ao_list`, `ao_events`
- Control: `ao_cancel`, `ao_cleanup`
- Approval: `ao_decision_get`, `ao_decision_approve`

Provider IDs are `claude`, `codex`, `grok-build`, and `kimi`.

Routing policy defaults:

- Architecture: Claude Fable (Opus fallback) and OpenAI Sol in the max-effort adversarial protocol.
- Design: Claude Fable/Opus at high effort.
- Implementation: OpenAI Sol at high effort, raised to max for high/critical risk or explicitly set.
- Research: Grok Build when available.
- Large-context work: Kimi when available.
- Review: a provider family different from the originating implementation when possible.
