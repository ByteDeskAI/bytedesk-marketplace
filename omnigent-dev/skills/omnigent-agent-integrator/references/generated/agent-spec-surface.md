# Omnigent Agent Spec Surface

Generated from agent spec docs and typed config source.

## Spec Headings
### `docs/AGENT_YAML_SPEC.md`
- # Agent YAML spec
- ## Minimal agent
- ## Common top-level fields
- ## Executor
- ### Antigravity (Gemini)
- ## Local OS access
- ## Tools
- ### MCP server
- ### Python function tool
- ### Sub-agent tool
- ## Policies
- ## Terminals
- ## Complete example
- ## Validation tips
### `omnigent/spec/AGENTSPEC.md`
- # Agent Image Spec
- ## Directory Layout
- ## config.yaml
- ### `interaction` axes
- ### `interaction.modalities`
- ### `tools.agents`
- ### `tools.builtins`
- ## Instructions
- ## Skills — `skills/<name>/SKILL.md`
- ## MCP Tools — `tools/mcp/<name>.yaml`
- ## Local Tools — `tools/python/*.py` / `tools/typescript/*.ts`
- ## Sub-agents — `agents/<name>/`
- ## Validation Rules
- ## Key Design Decisions
- ## Not Yet

## Typed Config Anchors
- `MCPServerConfig` in `omnigent/spec/types.py`
- `MCPOAuthConfig` in `omnigent/spec/types.py`
- `LocalToolInfo` in `omnigent/spec/types.py`
- `PolicySpec` in `omnigent/spec/types.py`
- `FunctionPolicySpec` in `omnigent/spec/types.py`
- `AgentSpec` in `omnigent/spec/types.py`

## Design Rule
- Prefer extending the typed spec parser/validator and examples together; do not add undocumented YAML fields.
- Any new external tool shape needs spec docs, parser support, validation, runtime handling, and tests.