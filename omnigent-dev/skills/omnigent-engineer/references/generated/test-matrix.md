# Omnigent Test Matrix

Generated from `tests/` plus repo contribution policy.

## Test Suites
- `tests/_fixtures/`
- `tests/_helpers/`
- `tests/accountability/`
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
- `tests/peer/`
- `tests/policies/`
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
- `tests/terminals/`
- `tests/tool_steps/`
- `tests/tools/`

## Verification Defaults
- Python behavior: `uv run --extra dev pytest <focused paths>`.
- Python style: `uv run ruff check . && uv run ruff format --check .`.
- Pre-commit: `uv run pre-commit run --all-files` when preparing a broad PR.
- Frontend behavior: `cd ap-web && npm test -- <focused test>` plus `npm run lint` and `npm run build` when UI behavior changes.
- E2E: add or update `tests/e2e/` for new user-facing backend/full-stack features; add `tests/e2e_ui/` for user-facing `ap-web/` behavior.