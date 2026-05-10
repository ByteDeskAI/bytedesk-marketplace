#!/usr/bin/env bash
# fleet/web/build.sh — build the web server binary.
#
# Phase 1 (BDM-15): builds the Go server only. The Preact SPA bundle pipeline
# lands in Phase 2; this script will then also drive `npm run build` to write
# the SPA into `fleet/web/dist/` before the Go binary embeds it.
#
# Output:
#   fleet/bin/claude-sessions-web   (the binary registered as a plugin monitor)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SRC_DIR="$SCRIPT_DIR/server"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$PLUGIN_ROOT/bin/claude-sessions-web"

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
