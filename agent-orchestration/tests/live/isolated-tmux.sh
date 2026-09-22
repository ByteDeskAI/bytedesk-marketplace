#!/usr/bin/env bash
# Sourced by live fixture scripts. Every child and teardown uses this owned socket.
AO_TEST_RUNTIME=$(mktemp -d -t ao-live-runtime-XXXXXX)
export TMUX=''
export TMUX_TMPDIR="$AO_TEST_RUNTIME/tmux-tmp"
export AGENT_ORCHESTRATION_STATE_HOME="$AO_TEST_RUNTIME/state"
export XDG_CONFIG_HOME="$AO_TEST_RUNTIME/config"
export AO_TEST_SOCKET="$AO_TEST_RUNTIME/server.sock"
export AO_REAL_TMUX
AO_REAL_TMUX=$(command -v tmux)
mkdir -p "$TMUX_TMPDIR"
cat > "$AO_TEST_RUNTIME/tmux" <<'SH'
#!/usr/bin/env bash
exec "$AO_REAL_TMUX" -S "$AO_TEST_SOCKET" "$@"
SH
chmod 700 "$AO_TEST_RUNTIME/tmux"
export AO_TMUX_COMMAND="$AO_TEST_RUNTIME/tmux"
tmux() { command "$AO_REAL_TMUX" -S "$AO_TEST_SOCKET" "$@"; }
cleanup_test_tmux() {
  command "$AO_REAL_TMUX" -S "$AO_TEST_SOCKET" kill-server 2>/dev/null || true
  rm -rf -- "$AO_TEST_RUNTIME"
}
