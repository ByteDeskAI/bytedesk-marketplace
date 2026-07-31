#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== unit tests ==="
node --test tests/unit/*.test.mjs

echo "=== smoke: store ==="
bash tests/test-store.sh

echo "=== smoke: validate ==="
bash tests/test-validate.sh

echo "=== smoke: hooks ==="
bash tests/test-hooks.sh

echo "=== smoke: mcp ==="
bash tests/test-mcp.sh

echo "ALL knowledge-management tests passed"
