# Agent Orchestration Session

Per-run operator window. `orchestration_spawn` returns `session.url`. On Linux/WSL the broker launches
`agent-orchestration session-host` under `systemd-run --user --scope` (one unit per state root) and
joins a live lease instead of listening in the MCP process. Native Windows stays in-process.
`AGENT_ORCHESTRATION_SESSION_SUPERVISOR=0` forces in-process.

The CLI binds `127.0.0.1` and serves `dist/session-ui/` (copied from `session-ui/mockup/` at build
time). It is a store-backed control plane so cancel / follow-up / decision still work after MCP exit.

This directory still holds the operator mockup plus:

- Plan: `docs/plans/2026-08-22-orchestration-session.md`
- Mockup: `session-ui/mockup/`
- Serve (prints `Orchestration session: <url>`): `session-ui/serve.mjs`

```sh
node session-ui/serve.mjs
# Orchestration session: http://127.0.0.1:<port>/
```

`AO_SESSION_NO_OPEN=1` skips `xdg-open`. Bind is `127.0.0.1` only.

The mockup fixture control in the corner switches empty / running / waiting_for_decision / failed /
succeeded / cancelled. ⌘K opens the command palette. That control is mockup-only and will not ship
in the live session server.
