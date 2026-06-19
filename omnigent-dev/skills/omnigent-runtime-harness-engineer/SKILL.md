---
name: omnigent-runtime-harness-engineer
description: Omnigent runtime, runner, host, tunnel, harness, native bridge, tool dispatch, cancellation, approval/elicitation, and executor engineering skill. Use for changes under omnigent/runtime, omnigent/runner, omnigent/host, omnigent/inner, harness adapters, native Claude/Codex/Cursor/Pi/Antigravity/OpenAI Agents behavior, and live harness debugging.
---

# Omnigent Runtime Harness Engineer

## Mission

Keep execution behavior coherent across the runtime loop, server/runner tunnel, inner harnesses, and provider-native bridges. Treat "the process returned" and "the agent behavior is correct" as different claims.

## References

Read:
- `references/generated/runtime-map.md`
- `references/generated/test-matrix.md`

Also use existing live harness skills when relevant:
- `/cursor-sdk-e2e-dev`
- `/antigravity-sdk-e2e-dev`

## Implementation Rules

- Start with the focused area tests for the touched subsystem.
- For harness changes, cover auth/model resolution, spawn env, tool bridge, streamed output, failure surfacing, and cleanup when touched.
- For cancellation or tunnel changes, include runner-unavailable and mid-flight disconnect behavior.
- For approval/elicitation changes, prove both SSE emission and resolution path.
- For tool dispatch changes, verify policy enforcement happens before side effects when the intended contract requires blocking.

## Live Proof

When credentials and environment are available, finish with a local server + remote runner smoke:
```bash
uv run omnigent server start
SERVER=<printed-url>
timeout 280 uv run omnigent run <agent-dir> --server "$SERVER" -p "Reply with exactly: PONG"
```

If live proof is skipped, state exactly which credential, SDK, or host prerequisite was missing.