---
type: reference
title: Gateway tab ids are server-minted
description: The gateway mints tab ids and derives session names from them; req.Session was decoded then overwritten until TM-097 made the builder honour it, and prefix-matching sessions ARE discovered at startup
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

So a tab is the record and the tmux session name is derived from it — never the reverse.

**Correction (2026-09-05, TM-097).** The claim that previously stood here — that a tmux session
created outside the gateway is invisible no matter what it is named, because nothing wrote a tab
record — is FALSE. `mergeDiscoveredTabRecords` (`src/tab_restore.go:801`) runs `tmux list-sessions`
at gateway start and adopts any session named `<tmuxSession>-<id>` as a new tab record. Discovery by
convention does exist. What is true is narrower and still load-bearing: it runs **only at startup**,
and **only for names matching the prefix convention**, so a session named anything else stays
invisible — because of the prefix, not because discovery is absent.

## The trap

`req.Session` is on the request struct and is decoded, but the builder **overwrites it** at line
206. It is honoured only on read-back paths (`terminal_runtime_tabs.go:304`, `367`, `949`). A caller
that supplies `session` in the POST body is silently ignored — no error, no warning.

## Ways to attach an externally-created session

1. **Honour `req.Session` in the builder** — IMPLEMENTED by TM-097 on branch
   `ep014/session-pinning` (commit `cc70a11`), not yet merged. It was not the three-line change
   estimated here; it needed a validation rule and a collision rule:
   - charset letters/digits/`-`/`_`, max 96 chars, whitespace rejected rather than trimmed.
   - **`.` and `:` are refused.** Measured on tmux 3.4: `new-session -s "a.b"` silently creates
     `a_b`, and `has-session -t "a.b"` then fails with `can't find pane: b`. Allowing a dot would
     make `ensureTmuxSession`'s probe miss and `attach-session -t` fail — the feature would break
     silently, which is exactly the failure mode this concept exists to warn about.
   - collision: 400 if the name resolves to a live tab or a pending-restore record (via
     `sessionNameForRecord`, so a legacy row with an empty `Session` still defends its derived
     name). A tmux session belonging to no tab is free to adopt — that is the point.
2. **A dedicated adopt endpoint** taking session name + kind + cwd and writing a tab record around
   an existing session. More surface, clearer contract.
3. **Invert ownership** — let the gateway create the tab, read back its id and derived session name,
   and have the orchestrator attach to that session rather than creating its own. No gateway change,
   but session creation stops being the orchestrator's.

Not viable: the `NewTabID` dependency-injection seam (`launch_request_builder.go:69-71`) is
in-process only and unreachable over HTTP.

## Restart and cutover, measured

`tryRestoreOne` (`src/tab_restore.go:588`) branches on whether the session is still alive:

- **alive → reattached.** No `new-session`; the orchestrator's process and the scrollback survive.
- **gone → recreated from the RECORD's `Command`** (or `defaultRestoreCommand(kind)` when empty),
  *not* from whatever the orchestrator actually ran. The gateway only ever stored the command it
  assembled at create time, so an adopted pane comes back as a fresh gateway-shaped shell. Plan for
  this: a durable role-session must be reconstructible from the tab record, or it comes back wrong.

Verified with a recording fake tmux plus one real-tmux adoption test. NOT verified end to end
through a live gateway over HTTP to a ttyd iframe.

## Related

`listAgentSessions` (`src/agent_sessions.go:119`) enumerates tmux by the `tmuxSession + "-"` prefix,
but that is the idle/reaper view behind `/terminal/api/agent-sessions`. A prefix-matching session
appears there with an empty `TabID` and never becomes a tab.
