# Incident — a test destroyed the operator's tmux server and 37 live agent sessions

**When:** 2026-09-09, ~21:07:51 (tmux server restart time).
**Impact:** all 37 live tmux sessions destroyed, including the entire gateway
swarm this epic's design work was mined from. Four sessions exist now, all
created after the restart.
**Data loss:** none at the file level. Every repository working tree was verified
intact afterwards — `bytedesk-remote-gateway` and `bytedesk-board` clean at their
HEADs, `bytedesk-passport`'s 350 dirty files are its own pre-existing work. What
was lost is running agent sessions and their in-memory conversation context.

## Cause

`agent-orchestration/tests/unit/topology-supervision-consistency.test.mjs`, the
test that arrived with the salvaged TM-140/141 work, had:

```js
t.after(() => run('tmux', ['kill-server'], { env, allowFailure: true }));
```

`env` set `TMUX_TMPDIR`, which **looks** isolated. But it also inherited `$TMUX`
from the operator's shell. A tmux client with `$TMUX` set addresses the server
named in that variable, not the one implied by `TMUX_TMPDIR` — so `kill-server`
went to the operator's real server and did exactly what it says.

`TMUX_TMPDIR` only decides where a *new* server's socket is created. It does not
redirect a client that already has a server to talk to.

## Why review did not catch it

The integrator (this session) read the diff and merged it. A bare `kill-server`
in a teardown is precisely the class of thing review exists to stop, and it was
visible in the diff. This was an integration failure, not a subtle one.

## Fixes

1. `181f862` (peer session) — the offending test now sets `TMUX: ''` and scopes
   the kill with `-S <socket>` obtained from `display-message -p '#{socket_path}'`,
   plus an assertion that the fixture cannot inherit an operator server.
2. `8beb169` (this session) — audit of every tmux teardown in the suite. Six were
   already socket-scoped. One, in `tests/contract/topology-tmux.test.mjs`, was
   still a bare `kill-server`. Its env **is** genuinely isolated (`TMUX: ''` and
   `TMUX_TMPDIR` both set), so it was not the cause and was not a live bug — but
   "safe because of an env literal sixty lines away" is one careless edit from a
   repeat, and every sibling teardown already names its socket. It now does too,
   with the incident recorded in the comment so nobody simplifies it back.

Verified after the fixes: contract suite 4/4 and topology 294/294, with the live
tmux session count unchanged across both runs.

## Standing rule for this repository

Any test that touches tmux must do **all three**, not any one of them:

- `TMUX: ''` in the env, so no operator server is inherited;
- `TMUX_TMPDIR` pointed at a temp dir, so a new server is isolated;
- every `kill-server` / `kill-session` scoped with an explicit `-S <socket>` or
  `-L <name>`.

Env isolation alone is not sufficient, and this incident is the proof.
