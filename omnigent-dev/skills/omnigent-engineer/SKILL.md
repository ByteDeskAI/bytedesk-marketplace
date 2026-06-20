---
name: omnigent-engineer
description: Omnigent source-development hub skill. Use for feature work, bug fixes, test planning, code review, PR prep, or any broad change in the bytedesk-omnigent repo; routes work to the operator, architect, runtime/harness, agent-bundle, API/SDK, or web/deploy Omnigent skills and requires refreshing generated references when architecture/API/test surfaces may have drifted.
---

# Omnigent Engineer

## Mission

Act as the default engineer for `bytedesk-omnigent`. Start by grounding in the current checkout, choose the narrowest specialist skill that fits, and keep the implementation loop test-first and source-derived.

## First Moves

1. Run `git status --short --branch` and `node scripts/dev/workflow.mjs status --no-fetch`.
2. If generated skill references may be stale, run:
   ```bash
   node scripts/dev/workflow.mjs omnigent-skills check
   ```
   Use `omnigent-skills apply` only when the task includes updating the skill suite or the stale references affect the work.
3. Read only the generated references needed for the task:
   - `references/generated/repo-map.md`
   - `references/generated/test-matrix.md`
   - `references/generated/cli-surface.md`

## Route the Work

| Task | Use |
|---|---|
| Worktree, ship, land, local server/host, PR state, cleanup | `/omnigent-operator` |
| Pre-implementation review, boundary checks, pattern fit | `/omnigent-architect` |
| Runtime loop, runner, host, tunnel, harness, tool dispatch | `/omnigent-runtime-harness-engineer` |
| Agent YAML, bundles, tools, MCP, policies, terminals, sub-agents | `/omnigent-agent-integrator` |
| REST/SSE/WebSocket, OpenAPI, Python SDK, auth/session resources | `/omnigent-api-sdk-engineer` |
| `ap-web`, desktop/web UI, deploy targets, sandboxes | `/omnigent-web-deploy-engineer` |

## Development Law

- Keep behavior changes covered by the smallest matching test suite; use the generated test matrix to choose.
- For bugs, write or identify the failing test before changing production code.
- For API/event/schema changes, update docs/OpenAPI/SDK/tests in the same change.
- For harness/runtime changes, prove both local unit behavior and the relevant live/e2e recipe when credentials are available.
- Avoid platform assumptions unless the user explicitly asks for cross-repo integration.
