#!/usr/bin/env bash
# Register this product checkout with get. Does not create get.yaml here.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ID=""
TITLE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    *) echo "unknown $1" >&2; exit 2 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT" ]] || { echo "not a git checkout" >&2; exit 2; }
REMOTE="$(git -C "$ROOT" remote get-url origin)"

# Always normalize to owner/repo (same as getctl --from-remote / ParseGitHubRemote).
GITHUB="$("$HERE/parse-github-remote.sh" "$REMOTE")"

if [[ -n "${BYTEDESK_GET_ORIGIN:-}" ]]; then
  ID="${ID:-$(basename "$ROOT")}"
  TITLE="${TITLE:-$ID}"
  curl -fsS -X POST "${BYTEDESK_GET_ORIGIN%/}/admin/register" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"$ID\",\"github\":\"$GITHUB\",\"title\":\"$TITLE\"}"
  echo
  exit 0
fi

GET_REPO="${GET_REPO:-$ROOT/../get.bytedesk.ai}"
if [[ ! -d "$GET_REPO/apps" ]]; then
  echo "set GET_REPO to a get.bytedesk.ai checkout or BYTEDESK_GET_ORIGIN" >&2
  exit 2
fi
exec go run "$GET_REPO/cmd/getctl" register \
  --apps-dir "$GET_REPO/apps" \
  --from-remote "$REMOTE" \
  ${ID:+--id "$ID"} \
  ${TITLE:+--title "$TITLE"}
