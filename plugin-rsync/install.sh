#!/usr/bin/env bash
# Put plugin-rsync on PATH. User-scope only — never a project extraKnownMarketplaces entry.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == "--uninstall" ]]; then
  dest="${HOME}/.local/bin/plugin-rsync"
  if [[ -f "$dest" ]] && grep -q plugin-rsync-setup-cli-wrapper "$dest"; then
    rm -f "$dest"
    echo "removed $dest"
    exit 0
  fi
  echo "plugin-rsync: no wrapper of ours at $dest" >&2
  exit 1
fi
node "$ROOT/bin/plugin-rsync" install-cli
