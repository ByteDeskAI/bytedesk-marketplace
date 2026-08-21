#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"

node --test tests/unit/*.test.mjs

if [ "${1:-}" = "contract" ]; then
  npm run build:check
  node --test tests/contract/*.test.mjs
fi
