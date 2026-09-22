#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Extract only the file-generation function, never execute an installer.
sed -n '/^# BEGIN gateway containment unit contract v1/,/^# END gateway containment unit contract v1/p' "$here/install.sh" >"$tmp/contract.sh"
source "$tmp/contract.sh"
mkdir -p "$tmp/bin"
cat >"$tmp/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
  --version) echo "systemd ${FIXTURE_SYSTEMD_VERSION:-255}" ;;
  --user\ show\ *) exit 1 ;;
  *) echo 'unexpected mutating systemctl call' >&2; exit 91 ;;
esac
MOCK
chmod +x "$tmp/bin/systemctl"
export PATH="$tmp/bin:$PATH"
export FIXTURE_SYSTEMD_VERSION=253
bdgw_containment_unit_contract "$tmp/old" bytedesk-gateway.service >"$tmp/old-unit" 2>"$tmp/old-log"
[[ ! -s "$tmp/old-unit" && ! -e "$tmp/old" ]]
export FIXTURE_SYSTEMD_VERSION=255
home="$tmp/home space%\$value"
bdgw_containment_unit_contract "$home" bytedesk-gateway.service >"$tmp/unit" 2>"$tmp/log"
grep -qx 'Delegate=cpu memory pids' "$tmp/unit"
grep -qx 'DelegateSubgroup=host' "$tmp/unit"
grep -q '^ExecStartPre=-.* prepare bytedesk-gateway.service ' "$tmp/unit"
grep -q '^ExecStopPost=.* cleanup bytedesk-gateway.service ' "$tmp/unit"
grep -Fq 'home space%%$$value' "$tmp/unit"
grep -q 'containment_activation=unverified' "$tmp/log"
[[ -f "$home/libexec/gateway-containment.py" ]]
# Parse a generated fixture unit; verification never starts or installs it.
if command -v systemd-analyze >/dev/null 2>&1; then
  {
    printf '%s\n' '[Unit]' 'Description=Containment fixture' '[Service]' 'Type=oneshot' 'ExecStart=/bin/true' 'KillMode=process'
    cat "$tmp/unit"
  } >"$tmp/bytedesk-containment-fixture.service"
  systemd-analyze --user verify "$tmp/bytedesk-containment-fixture.service" >"$tmp/verify" 2>&1 || { cat "$tmp/verify" >&2; exit 1; }
fi
# Refuse helper-directory aliases; do not write through them.
mkdir -p "$tmp/alias" "$tmp/outside"
ln -s "$tmp/outside" "$tmp/alias/libexec"
if bdgw_containment_unit_contract "$tmp/alias" bytedesk-gateway.service >/dev/null 2>&1; then exit 1; fi
[[ ! -e "$tmp/outside/gateway-containment.py" ]]
root="$(cd "$here/../../../.." && pwd)"
if [[ -f "$root/cli" ]]; then
  for file in "$root/cli" "$root/scripts/commercial/install.sh"; do
    sed -n '/^# BEGIN gateway containment unit contract v1/,/^# END gateway containment unit contract v1/p' "$file" >"$tmp/copy"
    cmp "$tmp/contract.sh" "$tmp/copy"
  done
  cmp "$home/libexec/gateway-containment.py" "$root/setup/skills/gateway-doctor/scripts/containment.py"
  for file in "$root/cli" "$here/install.sh" "$root/scripts/commercial/install.sh"; do
    grep -q '^KillMode=process$' "$file"
    grep -q '^\$containment_unit_contract$' "$file"
    if grep -q '^KillMode=control-group$' "$file"; then exit 1; fi
  done
fi
# An unsupported platform generates no unit contract or helper.
uname() { echo Darwin; }
bdgw_containment_unit_contract "$tmp/darwin" bytedesk-gateway.service >"$tmp/darwin-unit" 2>/dev/null
[[ ! -s "$tmp/darwin-unit" && ! -e "$tmp/darwin" ]]
echo 'PASS containment installer generation, unsupported paths, quoting, copies, KillMode'
