#!/usr/bin/env bash
# Run remote-gateway login. The password stays out of this wrapper.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/login.py" "$@"
