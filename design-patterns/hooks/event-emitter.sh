#!/usr/bin/env bash
# PostToolUse hook — drop a coarse "edit" breadcrumb into the design-patterns
# pattern-memory journal whenever Claude edits a file (Edit / Write / MultiEdit).
#
# Breadcrumb ONLY: this records THAT a file changed, not which pattern or
# decision — intent lives in the conversation, not the tool input. Real
# applied-refactor outcomes are captured by the pattern-application skill
# calling `patterns memory record` / the patterns_record MCP tool.
# See design-patterns/docs/adr/0001-pattern-memory.md (BDM-56).
#
# Hook contract: exit 0 ALWAYS — an observability hook must never block a tool
# call. pattern_memory's writers already swallow their own errors; the shell
# adds a trap + `|| true` so nothing here can ever surface non-zero.

set -u
trap 'exit 0' ERR EXIT

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Pass the PostToolUse JSON straight through stdin to the recorder. It lives in
# a separate file rather than an inline heredoc on purpose — a `python3 - <<EOF`
# heredoc would hijack python's stdin, so the payload would never reach it.
# Anchor journal resolution at the project dir Claude Code reports.
# record_edit.py and pattern_memory both swallow their own errors; the trap
# above is the final backstop that keeps this hook from ever blocking a tool.
DP_ROOT="$ROOT" PWD="${CLAUDE_PROJECT_DIR:-$PWD}" python3 "$ROOT/hooks/record_edit.py" 2>/dev/null || true
exit 0
