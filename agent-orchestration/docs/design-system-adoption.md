# Agent Orchestration design release contract

The plugin owns `agent-orchestration` at the published design release `2.2.1`.
The exact `@bytedesk/design-tokens` dependency and development-only
`@bytedesk/design-client` are locked in the plugin package. The pin, 31 payload
files, generated README and context lock are inside this plugin directory and
explicitly included by `package.json.files`. They carry catalog source
`c050abca4c35cf3355f897af9e8d3c6e5c9eec61`. No sibling identity is included.

Run `npm ci --ignore-scripts` then `npm run design-system:check` here. Updating
the managed tree uses `npm run design-system:sync`. Sync downloaded the official
release; checking the committed tree requires no credentials or network.
The marketplace root pin and tree still belong to `task-management` and are
unchanged. No runtime UI was restyled and installed launchers do not fetch or
install design packages.

## Verification

- Committed blob hashes and a fresh Git archive are verified against every
  lock entry. A plugin-local Git attribute preserves exact context bytes: the
  root text attribute otherwise corrupted four staged PNG/ICO assets despite
  the working-tree check passing.
- Locked offline npm installation passes. The GitHub agent-orchestration
  workflow now checks the plugin-local tree after dependency installation;
  prepack also checks it. No remote workflow was queued.
- `sync --check` passes with a network namespace disabled, an empty environment
  and temporary HOME. The entire new package test also passes in that namespace.
- `tests/contract/design-system-package.test.mjs` packs the real npm artifact,
  extracts it beside a conflicting parent pin and checks the extracted tree.
  It rejects a missing plugin pin (no parent inheritance), modified context
  and an unexpected sibling identity; restored contents pass again. The
  extracted package contains no node_modules. Verification uses the locked
  development client outside the installed artifact, not a runtime dependency.
- Unit suite: 245 passed, 4 existing platform skips, 0 failed (249 total).
  Bundle drift check and clean installed-cache contract pass.
- Full contract suite: 2 passed, 1 failed. The tmux topology fake-agent readiness
  case also fails in an untouched archive of baseline `811e090`; its source and
  fixtures are unchanged. It is an existing gate blocker, not a green pipeline.
- Both versionless manifest checks pass. The previous workflow's Codex version
  equality check was reproduced failing and corrected to enforce the existing
  versionless contract. Plain Claude plugin validation passes with its expected
  advisory about the omitted version. No agent was dispatched through Claude.

No rollout, live
provider exercise, provisioning, paid resource or spending occurred.
