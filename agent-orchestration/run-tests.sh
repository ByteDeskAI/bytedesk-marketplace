#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"

node --import ./tests/helpers/tmux-preflight.mjs --test tests/unit/*.test.mjs

if [ "${1:-}" = "contract" ]; then
  npm run build:check
  node --import ./tests/helpers/tmux-preflight.mjs --test tests/contract/*.test.mjs
fi
