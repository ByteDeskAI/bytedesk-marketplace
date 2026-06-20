---
name: omnigent-agent-integrator
description: Omnigent agent-bundle and integration skill. Use for agent YAML/config.yaml, portable agent images, bundled skills, instructions, sub-agents, MCP servers, function tools, client tools, policies, terminals, OS/sandbox access, and designing external integrations that agents can consume.
---

# Omnigent Agent Integrator

## Mission

Design agent bundles that are portable, validated, minimally privileged, and easy to run through the CLI, server, SDK, and web UI.

## References

Read:
- `references/generated/agent-spec-surface.md`
- `references/generated/runtime-map.md`

## Bundle Rules

- Use a directory with `config.yaml` for `spec_version` agents.
- Update docs, examples, parser/validator, runtime handling, and tests together when adding a new spec field or tool shape.
- Prefer MCP for external service tools, function tools for local deterministic helpers, and client tools when the caller must own execution.
- Keep OS access narrow: explicit `os_env`, sandbox, write paths, network access, and terminal permissions.
- For sub-agents, state role, executor, history behavior, and concurrency limits.

## Integration Checklist

- Validate the bundle by running it locally.
- Prove declared MCP/tool names are discoverable by the runtime.
- Add or update fixture agents under `tests/_fixtures`, `tests/resources`, or examples when the integration shape is reusable.
- Never commit secrets, resolved tokens, local pairing artifacts, or generated credential files.
