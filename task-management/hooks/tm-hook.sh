#!/bin/sh
# Claude Code names this file via ${CLAUDE_PLUGIN_ROOT}. All logic lives in bin/tm-hook
# (Node) so Windows and Codex do not need bash.
EVENT="${1:-}"
[ -z "$EVENT" ] && exit 0
# TM-177: pre-bash guards dispatch workers only, and it runs on every Bash call — so everyone else
# leaves here, before a subshell or a Node start. TM-470: a worker is decided by recorded dispatch
# ancestry (lib/worker-identity.mjs), not by the env marker alone, so this fast path is taken only
# when there is no marker AND no worker is recorded on this machine at all. $HOME stands in for the
# passwd home here: this env is the harness's, set at spawn, not one a worker's Bash call can edit.
if [ "$EVENT" = "pre-bash" ] && [ -z "${TM_DISPATCH_WORKER:-}" ]; then
  REG="$HOME/.local/state/bytedesk/task-management/workers"
  [ -z "$(ls -A "$REG" ${TM_WORKER_REGISTRY:+"$TM_WORKER_REGISTRY"} 2>/dev/null | grep '\.json$')" ] && exit 0
fi
PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd) || exit 0
exec node "$PLUGIN_ROOT/bin/tm-hook" "$EVENT"
