---
type: reference
title: Gateway tab ids are server-minted
description: A caller cannot pin a remote-gateway tab id or tmux session name over HTTP; req.Session is decoded then overwritten
tags:
  - gateway
  - tmux
  - agent-orchestration
status: stable
generated:
  by: knowledge-management/0.1.0
  at: 2026-09-05T04:08:13.194Z
---

# Gateway tab ids are server-minted

A caller cannot pin a remote-gateway tab id or tmux session name over HTTP; req.Session is decoded then overwritten

## What was verified

`bytedesk-remote-gateway`, read 2026-09-05.

- `terminalTabRequest` (`src/main.go:462-471`) carries `Kind`, `CWD`, `Session`, `Options`,
  `Isolate`, `WorktreeName`. **There is no `ID` field**, and `decodeTerminalTabRequest`
  (`src/terminal_runtime_tabs.go:506`) adds none.
- `src/launch_request_builder.go:205-206` mints both identifiers unconditionally:

  ```go
  id := b.newTabID(kind)
  session := b.deps.TmuxSession + "-" + id
  ```

So a tab is the record and the tmux session name is derived from it — never the reverse. A tmux
session created outside the gateway is invisible to the SPA no matter what it is named, because
nothing wrote a tab record. Renaming does not help.

## The trap

`req.Session` is on the request struct and is decoded, but the builder **overwrites it** at line
206. It is honoured only on read-back paths (`terminal_runtime_tabs.go:304`, `367`, `949`). A caller
that supplies `session` in the POST body is silently ignored — no error, no warning.

## Ways to attach an externally-created session

1. **Honour `req.Session` in the builder** when present, validated against the `TmuxSession` prefix.
   The field, the plumbing through to `startTTYDTab`, and `ensureTmuxSession`'s existing
   `has-session` reuse (`terminal_runtime_tabs.go:724`) all already exist, so this is roughly a
   three-line change that turns the reuse path into an adopt path. Cheapest.
2. **A dedicated adopt endpoint** taking session name + kind + cwd and writing a tab record around
   an existing session. More surface, clearer contract.
3. **Invert ownership** — let the gateway create the tab, read back its id and derived session name,
   and have the orchestrator attach to that session rather than creating its own. No gateway change,
   but session creation stops being the orchestrator's.

Not viable: the `NewTabID` dependency-injection seam (`launch_request_builder.go:69-71`) is
in-process only and unreachable over HTTP.

## Related

`listAgentSessions` (`src/agent_sessions.go:119`) enumerates tmux by the `tmuxSession + "-"` prefix,
but that is the idle/reaper view behind `/terminal/api/agent-sessions`. A prefix-matching session
appears there with an empty `TabID` and never becomes a tab.
