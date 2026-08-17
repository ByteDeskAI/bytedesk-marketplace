#!/usr/bin/env sh
# SessionStart guard for the design-system plugin.
#
# Vendors the design system into an ALREADY-CONFIGURED repository whose vendored
# tree is missing — a fresh clone, or a checkout where .context/ was cleaned.
#
# It runs only when both hold:
#   1. <dir>/.source-sha is absent (nothing vendored yet), and
#   2. the repo already names its app, via <dir>/.design-system.json or an
#      .envrc that exports IMPECCABLE_CONTEXT_DIR=<dir>/profiles/<app>.
#
# It never guesses an app and never touches an unconfigured repository: if the
# app cannot be read from the repo itself, this exits silently. Refreshing an
# already-vendored tree is an explicit /design-system-sync, not a hook.

set -eu

DIR="${DESIGN_SYSTEM_DIR:-.context/design-system}"

# Already vendored — leave it alone; drift is a --check/CI concern, not a hook's.
[ -f "$DIR/.source-sha" ] && exit 0

app=""

if [ -f "$DIR/.design-system.json" ]; then
  app=$(sed -n 's/.*"app"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DIR/.design-system.json" | head -n 1)
fi

if [ -z "$app" ] && [ -f .envrc ]; then
  app=$(sed -n 's|.*IMPECCABLE_CONTEXT_DIR=.*/profiles/\([A-Za-z0-9_-]*\).*|\1|p' .envrc | head -n 1)
fi

# Unconfigured repository — no-op, silently.
[ -z "$app" ] && exit 0

command -v node >/dev/null 2>&1 || exit 0

node "${CLAUDE_PLUGIN_ROOT}/scripts/design-system-sync.mjs" --app "$app" --dir "$DIR" || exit 0
