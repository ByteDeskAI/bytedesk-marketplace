#!/usr/bin/env bash
# Render an HTML file or URL at the mockup's logical size. usage: shoot.sh <file.html|url> <out.png> [1280x800]
# Uses the Playwright CLI (npx) so nothing has to be installed into the run folder.
set -euo pipefail
SRC="${1:?html file or url}"; OUT="${2:?out.png}"; SIZE="${3:-1280x800}"
case "$SRC" in http://*|https://*|file://*) URL="$SRC" ;; *) URL="file://$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")" ;; esac
npx --yes playwright screenshot --browser chromium --viewport-size="${SIZE/x/,}" --wait-for-timeout 400 "$URL" "$OUT" >/dev/null
echo "$OUT"
