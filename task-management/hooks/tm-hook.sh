#!/bin/sh
# Claude Code names this file via ${CLAUDE_PLUGIN_ROOT}. All logic lives in bin/tm-hook
# (Node) so Windows and Codex do not need bash.
EVENT="${1:-}"
[ -z "$EVENT" ] && exit 0
PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd) || exit 0
exec node "$PLUGIN_ROOT/bin/tm-hook" "$EVENT"
