---
name: agent-orchestration-doctor
description: Diagnose the agent-orchestration plugin, provider CLIs, ACP adapters, state paths, and routing catalog without exposing secrets or sending provider prompts. Use when orchestration cannot spawn, a provider is missing, an installed plugin fails to start, or the user asks whether Claude, Codex, Grok, or Kimi is available.
user-invokable: true
argument-hint: "[provider: claude | codex | grok-build | kimi]"
---

# Agent Orchestration Doctor

1. Call `orchestration_capabilities` to inspect the server and provider catalog.
2. Call `orchestration_doctor` and select the requested provider from its independent probe results.
3. Report executable discovery, adapter readiness, authentication status only as ready/not-ready,
   writable state-path checks, and actionable remediation.
4. If a consumer repository matters, pass its explicit absolute path as `consumerCwd`. Never use the
   server process cwd as a substitute.
5. Do not print environment values, tokens, credential filenames containing secrets, or provider
   configuration contents. Do not install software, authenticate, spawn an agent, or repair state
   unless the user separately authorizes that mutation.

Provider availability is independent: a missing Kimi CLI must not make Claude, Codex, or Grok unhealthy.
Differentiate a missing prerequisite, unauthenticated provider, incompatible adapter, invalid state,
and transport failure rather than returning one generic unavailable result.
