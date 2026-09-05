---
name: caps
description: Probe what this host can dispatch work to — topology, orchestration, tmux, manual, harness CLIs, sandbox binaries — via tm caps / GET /api/caps. Use before tm dispatch or tm pool, when a backend is "unavailable", or when the user says "what can this machine run", "host capabilities", "/caps".
user-invokable: true
argument-hint: "[--json]"
---

# Caps

Host probe, not a store read. Answers on a bare checkout. A missing dependency is
`available: false` plus a reason, never an exception.

## When to use

Before [[dispatch]] or [[pool]]. After a dispatch refusal that lists `tried`. When
wiring a new harness.

## Usage

```
.bytedesk/task-management/bin/tm caps
.bytedesk/task-management/bin/tm caps --json
```

HTTP: `GET /api/caps`. No MCP tool — shell the CLI or hit the dashboard.

Order walked by dispatch when unpinned: **topology → tmux → orchestration → manual**.
`manual` is always available. Override with `tm config dispatch.backends '["tmux","manual"]'`.

Probes: `TM_ORCHESTRATION_BIN` / `TM_TOPOLOGY_BIN` → sibling marketplace plugin →
`~/.claude/plugins/**`. CLIs (`claude`,`codex`,`grok`,`kimi`,`pi`) and sandbox
(`bwrap`,`systemd-run`,`slirp4netns`) are PATH lookups. `TM_HOSTCAPS_DEBUG=1` traces.

Full table: `docs/agent-first.md`.

## Related

Next: [[dispatch]]. Loop: [[pool]]. After a run: [[collect]]. Watch: [[events]].
