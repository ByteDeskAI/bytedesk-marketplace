#!/usr/bin/env bash
# CLI smoke: init, concept, validate, find, show, graph, verify, lint, doctor, export, viz
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KM="$ROOT/bin/km"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export KM_ROOT="$TMP"
export KM_NO_AUTOLINK=1

echo "== init =="
node "$KM" init
test -f "$TMP/.bytedesk/knowledge/index.md"

echo "== concept new =="
node "$KM" concept new "Smoke Concept" --type Architecture --dir architecture --desc "smoke test concept"

echo "== validate =="
node "$KM" validate

echo "== find/show =="
node "$KM" find Architecture | grep -qi smoke
node "$KM" show architecture/smoke-concept | grep -qi Architecture

echo "== graph/backlinks =="
node "$KM" graph --mermaid | grep -q flowchart
node "$KM" backlinks architecture/smoke-concept >/dev/null

echo "== verify =="
node "$KM" verify architecture/smoke-concept

echo "== lint doctor log export viz =="
node "$KM" lint >/dev/null
node "$KM" doctor >/dev/null
node "$KM" log 5 >/dev/null
node "$KM" export md | grep -qi Smoke
node "$KM" viz --out "$TMP/viz.html"
test -f "$TMP/viz.html"

echo "== reindex =="
node "$KM" reindex

echo "test-store.sh OK"
