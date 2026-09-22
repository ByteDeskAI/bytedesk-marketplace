#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home" "$tmp/bin"
printf '%s\n' 'SESSION_SECRET=do-not-print-fixture-secret' 'SETUP_TOKEN=do-not-print-fixture-token' 'LISTEN_HOST=127.0.0.1' 'LISTEN_PORT=18443' "touch '$tmp/executed'" >"$tmp/home/control.env"
cat >"$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat >"$tmp/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
exit 1
MOCK
chmod +x "$tmp/bin/curl" "$tmp/bin/systemctl"
PATH="$tmp/bin:$PATH" BYTEDESK_GATEWAY_HOME="$tmp/home" bash "$here/doctor.sh" >"$tmp/output"
[[ ! -e "$tmp/executed" ]]
if grep -q 'do-not-print' "$tmp/output"; then echo 'FAIL secret leaked' >&2; exit 1; fi
grep -q '^containment_activation=unverified$' "$tmp/output"
grep -q '^containment_user_unit=unavailable$' "$tmp/output"
grep -q '^healthz=REACHABLE$' "$tmp/output"
echo 'PASS doctor read-only environment parsing, no secrets, unavailable unit'
