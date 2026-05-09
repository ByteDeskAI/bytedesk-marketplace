---
name: fleet-wait
description: Block until one or more sessions reach a target state (default done). Closes the no-event-callback gap in the multi-session system — anything that needs to react when an agent finishes uses this. Use when the user says "fleet wait", "/fleet-wait", "wait until BDP-N is done", "wait for these to finish", or any phrasing about pausing for sessions to reach a state. Also called internally by /fleet-chain, /fleet-cleanup, and /fleet-review.
user-invokable: true
argument-hint: "<BDP-N> [BDP-M ...] [--state STATE] [--timeout MIN] [--interval SEC]"
allowed-tools:
  - Bash
---

## What this skill does

Polls the dashboard at a fixed interval and blocks until every named session has reached the target state, or until the timeout elapses. Reports the outcome per session.

This exists because the dashboard does not push events to skills — anything that needs to react to a session finishing must poll. Centralizing that polling here means /fleet-chain, /fleet-cleanup, and /fleet-review can all build on the same primitive.

## Steps

1. Parse args:
   - **Tickets** (positional): one or more `BDP-N` keys.
   - **`--state STATE`**: target state (`done` default). Other valid: `needs-input`, `error`, `idle`, `gone`.
   - **`--timeout MIN`**: max wait in minutes (default `60`).
   - **`--interval SEC`**: poll interval in seconds (default `15`).
2. Validate: every ticket must currently exist as a session (`claude-sessions | grep <ticket>`). If any are missing, fail fast with the list of missing tickets.
3. Compute deadline = now + timeout.
4. Loop:
   - Run `claude-sessions` and parse each named session's STATE.
   - If every session has reached the target state (or `gone`), break with success.
   - If now > deadline, break with timeout.
   - Sleep `interval` seconds.
5. Report final state per ticket. If all hit target, exit success. If timeout, exit with a warning and the laggards listed.

## Output format

While polling (every 5 polls or on state change, whichever first):
```
Waiting for done: BDP-360 (working) · BDP-361 (needs-input) · BDP-362 (done)  [4m elapsed, 56m left]
```

Final:
```
✓ All 3 sessions reached done in 12m
   BDP-360, BDP-361, BDP-362
```
or
```
⚠ Timed out after 60m. Reached target: BDP-360, BDP-362.  Still: BDP-361 (working)
   Next:  /fleet-wait BDP-361 --timeout 30   to keep waiting
          claude-sessions attach BDP-361     to investigate
```

## Long-running considerations

The skill blocks until the wait completes. For long waits (>15min), prefer running it in a backgrounded Bash call so chat stays responsive. The script is safe to backgrounded — its output appends to a log you can tail.

## Constraints

- Never kill or modify sessions. Only observe.
- Treat `gone` (session ended) as terminal regardless of target state — if the target was `done` and the session is `gone`, that's still "reached" (just record it as `gone` in the report).
- Default timeout is generous (60min) — long enough for most feature implementations to complete. Don't auto-extend on timeout; let the user re-invoke.

## Examples

```
/fleet-wait BDP-360
/fleet-wait BDP-360 BDP-361 BDP-362
/fleet-wait BDP-360 --state needs-input        # wait until it stops on a question
/fleet-wait BDP-360 --timeout 120 --interval 30
```
