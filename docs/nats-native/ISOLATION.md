# Running real agents against a build under test (TM-331)

A real `claude` pane loads the operator's installed agent-orchestration plugin, so a build under
test is silently replaced by the installed one. In the EP-026 runs this wrote an old-format
`state.json`, stopped the local NATS server and restarted it on a new port every ~30 s. Use every
step below, and check each one before you read a result.

| Step | Why | Check |
|---|---|---|
| `export PATH="<build>/agent-orchestration/bin:$PATH"` | the plugin's `bin/` is put first on a pane's PATH, so `ao-topology` would be the installed one | `readlink -f $(command -v ao-topology)` names your build |
| `export AGENT_ORCHESTRATION_BIN=<build>/agent-orchestration/bin/agent-orchestration` | the shell inherits the installed value; panes run `services ensure` from it | `echo $AGENT_ORCHESTRATION_BIN` |
| Start each `claude` agent with `--settings '{"enabledPlugins":{"agent-orchestration@bytedesk":false}}'` (agent `args` in `agent.json` or the spec) | disables the installed plugin inside the pane; its PATH entry and hooks disappear | `ps` shows the flag; pane PATH starts with your build |
| `export AGENT_ORCHESTRATION_SERVICES=0` | stops `lead ensure` and friends registering the sandbox with the operator's real service manager | `current.json` under `~/.local/share/bytedesk/agent-orchestration/` keeps its old mtime |
| Own `AGENT_ORCHESTRATION_STATE_HOME`, `AO_NATS_HOME`, `XDG_CONFIG_HOME`; unset `NATS_URL`, `AO_NATS_URL`, `TM_NATS_URL`, `AO_TRANSPORT` | no shared state, no ambient server | `state.json` has `schema: 2` and no `pass` |
| Short paths: `TMUX_TMPDIR=/tmp/<short>` and a sandbox path under ~60 bytes | Unix sockets truncate at ~107 bytes (tmux, `admin.sock`) | no `File name too long`, no stray truncated socket |
| `TMUX=''`, scoped `tmux -S <socket> kill-server` | never touch the operator's tmux server | default `tmux ls` count unchanged after teardown |
| Answer the folder-trust prompt only in sandbox panes | a new agent directory prompts once | scripted against the sandbox socket only |

## Traps

- `pgrep -f`/`pkill -f` patterns that contain your sandbox path match your own shell command and
  can kill it (exit 144). Match a specific pid.
- A `ps | grep` that includes the grep or your own `zsh -c` line reports a leak that is not one.
  Anchor with `[n]ats-server -c`.
- `npm ci` in every git worktree before running tests; a worktree has no `node_modules` and
  failures read as code problems.
- A committed `dist/` bundle can hold an older copy of the code. `npm run build:check` must pass.
- Cross-repo mail waits on cached lead proof. With services off, nothing resumes it: run
  `ao-topology mailbox resume --consumer <destination repo>` after both leads are responsive.
