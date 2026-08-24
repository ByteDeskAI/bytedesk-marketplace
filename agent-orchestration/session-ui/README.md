# Agent Orchestration Session

Per-run operator window. The broker will start a loopback HTTP server when a run is spawned, print
the URL on the host terminal, and open a browser.

Phase 1 ships a loopback session host. `orchestration_spawn` returns `session.url`. The CLI
`agent-orchestration session-host` binds `127.0.0.1` and serves `dist/session-ui/` (copied from
`session-ui/mockup/` at build time).

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
