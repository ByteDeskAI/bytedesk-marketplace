# Tests that touch tmux must be isolated three ways, not one

On 2026-09-09 a test teardown in `agent-orchestration` destroyed the operator's
tmux server and **37 live agent sessions**. Full write-up:
`.bytedesk/task-management/evidence/INCIDENT-2026-09-09-tmux-server-destroyed.md`.

The teardown was:

```js
t.after(() => run('tmux', ['kill-server'], { env, allowFailure: true }));
```

`env` set `TMUX_TMPDIR`, which looks like isolation. It is not sufficient.

## The mechanism, because it is not obvious

`TMUX_TMPDIR` only decides where a **new** server creates its socket. A tmux
client that inherits `$TMUX` from the operator's shell addresses **the server
named in `$TMUX`**, regardless of `TMUX_TMPDIR`. So the client connected to the
operator's real server and `kill-server` did exactly what it says.

## The rule — all three, every time

Any test that runs `tmux` must:

1. set **`TMUX: ''`** in its env, so no operator server can be inherited;
2. set **`TMUX_TMPDIR`** to a per-test temp dir, so a new server is isolated;
3. scope every **`kill-server`** and **`kill-session`** with an explicit
   `-S <socket>` or `-L <name>` — never a bare one, even when the env looks right.

(3) is not redundant with (1) and (2). It is the guard that survives someone
editing the env literal sixty lines away.

Correct patterns to copy: `tests/unit/topology-supervision-consistency.test.mjs`
(queries `display-message -p '#{socket_path}'` and asserts `TMUX` is blank),
`tests/unit/topology-presence.test.mjs`, `tests/unit/topology-supervision.test.mjs`
(`-L <unique name>`).

Never create a tmux session on the default server from a test.

## Also

Run the suite with `node --test --test-concurrency=1`. The fully parallel unit
run is OOM-killed on this machine (exit 137).
