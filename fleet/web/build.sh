#!/usr/bin/env bash
# fleet/web/build.sh — full release build.
#
#   1. Preact SPA → server/dist/{index.html,app.js,app.css}   (esbuild via build.mjs)
#   2. Go binary  → fleet/bin/claude-sessions-web              (embeds server/dist/)
#
# Phase 2 (BDM-16) wires the SPA build in. Subsequent phases extend the SPA
# but don't change the build chain.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SRC_DIR="$SCRIPT_DIR/server"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$PLUGIN_ROOT/bin/claude-sessions-web"

# 1. SPA build.
cd "$SCRIPT_DIR"
if [[ ! -d node_modules ]]; then
  echo "→ npm install (first run)"
  npm install --no-audit --no-fund --prefer-offline
fi
echo "→ npm run typecheck"
npm run typecheck
echo "→ npm run build (esbuild)"
npm run build

# 2. Go binary build.
cd "$SRC_DIR"
echo "→ go fmt"
go fmt ./...
echo "→ go vet"
go vet ./...
echo "→ go test"
go test ./...
echo "→ go build → $OUT"
mkdir -p "$(dirname "$OUT")"
go build -trimpath -ldflags="-s -w" -o "$OUT" .
chmod +x "$OUT"

echo "done. bin: $OUT"
"$OUT" -version
