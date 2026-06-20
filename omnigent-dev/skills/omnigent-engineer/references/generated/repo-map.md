# Omnigent Repo Map

Generated from `/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-omnigent`. Re-run `scripts/dev/workflow.mjs omnigent-skills apply` from Platform after source moves.

## Source Areas
- `omnigent/accountability/`
- `omnigent/client_tools/`
- `omnigent/db/`
- `omnigent/entities/`
- `omnigent/environments/`
- `omnigent/host/`
- `omnigent/inner/`
- `omnigent/llms/`
- `omnigent/onboarding/`
- `omnigent/policies/`
- `omnigent/repl/`
- `omnigent/resources/`
- `omnigent/runner/`
- `omnigent/runtime/`
- `omnigent/sandbox/`
- `omnigent/server/`
- `omnigent/spec/`
- `omnigent/stores/`
- `omnigent/terminals/`
- `omnigent/tool_steps/`
- `omnigent/tools/`

## Test Areas
- `tests/_fixtures/`
- `tests/_helpers/`
- `tests/accountability/`
- `tests/assignment/`
- `tests/bus/`
- `tests/cli/`
- `tests/client_tools/`
- `tests/compliance/`
- `tests/db/`
- `tests/deliberation/`
- `tests/deploy/`
- `tests/dev/`
- `tests/e2e/`
- `tests/e2e_ui/`
- `tests/entities/`
- `tests/environments/`
- `tests/executor_protocols/`
- `tests/extensions/`
- `tests/frontends/`
- `tests/github/`
- `tests/goals/`
- `tests/governance/`
- `tests/host/`
- `tests/idempotency/`
- `tests/ingress/`
- `tests/inner/`
- `tests/integration/`
- `tests/llms/`
- `tests/onboarding/`
- `tests/outcomes/`
- `tests/parity/`
- `tests/peer/`
- `tests/policies/`
- `tests/provider_metadata/`
- `tests/realtime/`
- `tests/release/`
- `tests/repl/`
- `tests/resources/`
- `tests/runner/`
- `tests/runtime/`
- `tests/sandbox/`
- `tests/scheduler/`
- `tests/scripts/`
- `tests/server/`
- `tests/sessions/`
- `tests/spec/`
- `tests/stores/`
- `tests/tasks/`
- `tests/terminals/`
- `tests/tool_steps/`
- `tests/tools/`

## Primary Docs
- `README.md`
- `CONTRIBUTING.md`
- `omnigent/server/API.md`
- `omnigent/server/DBSPEC.md`
- `omnigent/spec/AGENTSPEC.md`
- `docs/AGENT_YAML_SPEC.md`
- `docs/POLICIES.md`
- `deploy/README.md`

## Default Area-to-Test Rule
- Changes under `omnigent/<area>/` should normally add or update `tests/<area>/`.
- Use `tests/integration/` when behavior spans server, runner, runtime, or stores.
- Use `tests/e2e/` for full-stack user-visible flows that cannot be proven with a focused unit or integration test.
- Changes under `ap-web/` need colocated Vitest coverage and, for user-facing behavior, `tests/e2e_ui/` coverage.
