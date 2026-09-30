#!/usr/bin/env bash
# Self-isolating: temp dirs only, never touches the real ~/.claude.
set -u
S="$(cd "$(dirname "$0")" && pwd)/check-no-project-plugin-installs.mjs"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fail=0
expect() { local want=$1 label=$2; shift 2; "$@" >"$T/out" 2>&1; local got=$?; if [ "$got" != "$want" ]; then echo "FAIL $label: exit $got, wanted $want"; cat "$T/out"; fail=1; else echo "ok   $label"; fi; }
mkdir -p "$T/other/.claude" "$T/clean/.claude" "$T/dirty/.claude" "$T/off/.claude" "$T/bare"
echo '{"enabledPlugins":{"other@elsewhere":true}}' > "$T/clean/.claude/settings.json"
echo '{"enabledPlugins":{"agent-orchestration@bytedesk":true}}' > "$T/dirty/.claude/settings.json"
echo '{"enabledPlugins":{"agent-orchestration@bytedesk":false}}' > "$T/off/.claude/settings.json"
expect 0 "clean repo passes" node "$S" "$T/clean"
expect 0 "repo with no settings passes" node "$S" "$T/bare"
expect 0 "explicit false is not an install" node "$S" "$T/off"
expect 1 "enabled @bytedesk plugin fails" node "$S" "$T/dirty"
grep -q 'agent-orchestration@bytedesk' "$T/out" || { echo "FAIL violation text must name the plugin"; fail=1; }
expect 1 "one bad repo among several fails" node "$S" "$T/clean" "$T/dirty"
echo '{"plugins":{"agent-orchestration@bytedesk":[{"scope":"user"}]}}' > "$T/user.json"
echo '{"plugins":{"agent-orchestration@bytedesk":[{"scope":"user"},{"scope":"project","projectPath":"/x"}],"b@other":[{"scope":"project"}]}}' > "$T/proj.json"
echo '{"enabledPlugins":{"task-management@bytedesk":true}}' > "$T/other/.claude/settings.json"
expect 0 "a plugin outside the default list is not flagged" node "$S" "$T/other"
expect 1 "--plugin adds it" node "$S" "$T/other" --plugin task-management
expect 1 "--plugin all covers every @bytedesk plugin" node "$S" --plugin all "$T/other"
expect 0 "user-only installs pass" env AO_INSTALLED_PLUGINS="$T/user.json" node "$S" --installs
expect 1 "project-scope @bytedesk install fails" env AO_INSTALLED_PLUGINS="$T/proj.json" node "$S" --installs
grep -q '/x' "$T/out" || { echo "FAIL install violation must name the project path"; fail=1; }
expect 2 "missing installs file is an error, not a pass" env AO_INSTALLED_PLUGINS="$T/none.json" node "$S" --installs
expect 2 "unparseable settings is an error, not a pass" bash -c "mkdir -p $T/bad/.claude; echo '{' > $T/bad/.claude/settings.json; node $S $T/bad"
exit $fail
