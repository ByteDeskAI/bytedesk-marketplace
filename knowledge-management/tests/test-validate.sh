#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KM="$ROOT/bin/km"
GOOD="$(mktemp -d)"
BAD="$(mktemp -d)"
trap 'rm -rf "$GOOD" "$BAD"' EXIT

mkdir -p "$GOOD/.bytedesk/knowledge" "$BAD/.bytedesk/knowledge"
cp -a "$ROOT/tests/fixtures/bundles/good/." "$GOOD/.bytedesk/knowledge/"
mkdir -p "$GOOD/.bytedesk/knowledge/.km"
cp -a "$ROOT/tests/fixtures/bundles/bad/." "$BAD/.bytedesk/knowledge/"
mkdir -p "$BAD/.bytedesk/knowledge/.km"

echo "== good fixture =="
KM_ROOT="$GOOD" KM_NO_AUTOLINK=1 node "$KM" validate

echo "== bad fixture must fail =="
if KM_ROOT="$BAD" KM_NO_AUTOLINK=1 node "$KM" validate; then
  echo "expected validate to fail on bad fixture" >&2
  exit 1
fi

echo "test-validate.sh OK"
