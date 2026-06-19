#!/usr/bin/env bash
set -euo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$PLUGIN_ROOT/bin/goals-dashboard" ensure --open >/dev/null 2>&1 || true