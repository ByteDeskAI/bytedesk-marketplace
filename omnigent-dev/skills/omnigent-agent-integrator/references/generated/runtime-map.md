# Omnigent Runtime Map

Generated from `omnigent/inner`, `omnigent/runtime`, and `omnigent/runner`.

## Harness Files
- `omnigent/inner/antigravity_harness.py`
- `omnigent/inner/claude_native_harness.py`
- `omnigent/inner/claude_sdk_harness.py`
- `omnigent/inner/codex_harness.py`
- `omnigent/inner/codex_native_harness.py`
- `omnigent/inner/cursor_harness.py`
- `omnigent/inner/databricks_supervisor_harness.py`
- `omnigent/inner/grok_native_harness.py`
- `omnigent/inner/openai_agents_sdk_harness.py`
- `omnigent/inner/pi_harness.py`
- `omnigent/inner/pi_native_harness.py`

## Executor Files
- `omnigent/inner/antigravity_executor.py`
- `omnigent/inner/claude_native_executor.py`
- `omnigent/inner/claude_sdk_executor.py`
- `omnigent/inner/codex_executor.py`
- `omnigent/inner/codex_native_executor.py`
- `omnigent/inner/cursor_executor.py`
- `omnigent/inner/databricks_executor.py`
- `omnigent/inner/databricks_supervisor_executor.py`
- `omnigent/inner/grok_native_executor.py`
- `omnigent/inner/openai_agents_sdk_executor.py`
- `omnigent/inner/pi_executor.py`
- `omnigent/inner/pi_native_executor.py`

## Runtime Subsystems
- `omnigent/runtime/credentials/`
- `omnigent/runtime/executors/`
- `omnigent/runtime/harnesses/`
- `omnigent/runtime/policies/`

## Runner Modules
- `omnigent/runner/__init__.py`
- `omnigent/runner/_entry.py`
- `omnigent/runner/app.py`
- `omnigent/runner/cost_advisor.py`
- `omnigent/runner/cost_judge.py`
- `omnigent/runner/environment_filesystem.py`
- `omnigent/runner/identity.py`
- `omnigent/runner/mcp_manager.py`
- `omnigent/runner/pending_approvals.py`
- `omnigent/runner/policy.py`
- `omnigent/runner/proxy_mcp_manager.py`
- `omnigent/runner/resource_registry.py`
- `omnigent/runner/routing.py`
- `omnigent/runner/tool_dispatch.py`
- `omnigent/runner/uc_function.py`

## Runtime Change Rule
- Prove runner/server boundaries with tests that cover tunnel failure, cancellation, pending input, elicitations, and tool result paths when touched.
- Harness changes should include at least one focused unit test and a live/e2e recipe or existing harness skill update.