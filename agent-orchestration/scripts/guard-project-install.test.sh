#!/usr/bin/env bash
# Self-isolating: temp repos only.
set -u
H="$(cd "$(dirname "$0")" && pwd)/guard-project-install.mjs"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fail=0
run() { printf '{"tool_input":{"command":%s},"cwd":"%s"}' "$(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$1" | node "$H" >"$T/out" 2>&1; echo $?; }
expect() { [ "$1" = "$2" ] && echo "ok   $3" || { echo "FAIL $3: exit $1, wanted $2"; cat "$T/out"; fail=1; }; }
mkdir -p "$T/bad/.claude" "$T/good/.claude" "$T/bad/sub"
git init -q "$T/bad"; git init -q "$T/good"
echo '{"enabledPlugins":{"agent-orchestration@bytedesk":true}}' > "$T/bad/.claude/settings.json"
echo '{"enabledPlugins":{"fleet@bytedesk":true}}' > "$T/good/.claude/settings.json"
expect "$(run "$T/bad" 'git commit -m x')" 2 "commit in a repo that enables the plugin is blocked"
grep -q 'settings.json' "$T/out" || { echo "FAIL block message must name the file"; fail=1; }
expect "$(run "$T/bad/sub" 'git -C . commit --amend')" 2 "from a subdirectory, still finds the repo root"
expect "$(run "$T/bad" 'git status')" 0 "non-commit git command passes"
expect "$(run "$T/bad" 'ls && echo commit')" 0 "the word commit without git passes"
expect "$(run "$T/good" 'git commit -m x')" 0 "clean repo passes"
expect "$(run "$T/nowhere" 'git commit -m x')" 0 "missing directory fails open"
# TM-370: the AGENTS.md-mandated declaration passes; genuine per-project installs stay blocked.
mk() { mkdir -p "$T/$1/.claude"; git init -q "$T/$1"; printf '%s' "$2" > "$T/$1/.claude/settings.json"; }
REL='"extraKnownMarketplaces":{"bytedesk":{"source":{"source":"directory","path":"../bytedesk-marketplace"}}}'
mk mandated "{$REL,\"enabledPlugins\":{\"task-management@bytedesk\":true,\"agent-orchestration@bytedesk\":true}}"
expect "$(run "$T/mandated" 'git commit -m x')" 0 "relative-path marketplace + enabledPlugins (the AGENTS.md form) passes"
mk absolute '{"extraKnownMarketplaces":{"bytedesk":{"source":{"source":"directory","path":"/home/x/bytedesk-marketplace"}}},"enabledPlugins":{"task-management@bytedesk":true}}'
expect "$(run "$T/absolute" 'git commit -m x')" 2 "an absolute marketplace path is blocked"
grep -q 'relative to the repository' "$T/out" || { echo "FAIL absolute-path block must name the fix"; fail=1; }
mk cached "{$REL,\"enabledPlugins\":{\"task-management@bytedesk\":true}}"
mkdir -p "$T/cached/.claude/plugins/x"; echo '{}' > "$T/cached/.claude/plugins/x/plugin.json"; git -C "$T/cached" add .claude/plugins
expect "$(run "$T/cached" 'git commit -m x')" 2 "a committed .claude/plugins cache is blocked"
grep -q 'git rm -r --cached .claude/plugins' "$T/out" || { echo "FAIL cache block must name the fix"; fail=1; }
expect "$(run "$T/bad" 'git commit -m x')" 2 "enabledPlugins with no registered marketplace (a project-scope install) is still blocked"
grep -q 'AGENTS.md' "$T/out" && grep -q 'extraKnownMarketplaces' "$T/out" || { echo "FAIL block message must name the rule and the fix"; fail=1; }
echo 'not json' | node "$H" >/dev/null 2>&1; expect $? 0 "garbage stdin fails open"
exit $fail
