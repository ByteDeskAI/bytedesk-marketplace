#!/usr/bin/env bash
set -euo pipefail

# CI-only host preparation. This file is not part of the plugin payload.
# Ubuntu's optional profile permits Bubblewrap setup and denies capabilities to
# its children: https://discourse.ubuntu.com/t/58007
ao_sandbox_prerequisites() {
  if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${ImageOS:-}" != ubuntu24 ]]; then
    echo 'Refusing sandbox prerequisite changes outside a GitHub-hosted Ubuntu 24.04 job.' >&2
    return 1
  fi
  if [[ "$(lsb_release -is)" != Ubuntu || "$(lsb_release -rs)" != 24.04 ]]; then
    echo 'The sandbox prerequisite profile is validated only for Ubuntu 24.04.' >&2
    return 1
  fi
  : "${RUNNER_TEMP:?GitHub runner temporary directory is required}"
  local diagnostics="$RUNNER_TEMP/ao-sandbox-prerequisites"
  mkdir -p "$diagnostics"
  {
    local profile=/usr/share/apparmor/extra-profiles/bwrap-userns-restrict
    local userns_before unconfined_before userns_after unconfined_after smoke
    uname -sr
    printf 'AppArmor enabled: '
    cat /sys/module/apparmor/parameters/enabled
    [[ "$(cat /sys/module/apparmor/parameters/enabled)" == Y ]]
    userns_before=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)
    unconfined_before=$(sysctl -n kernel.apparmor_restrict_unprivileged_unconfined)
    printf 'Before: restrict_unprivileged_userns=%s restrict_unprivileged_unconfined=%s\n' "$userns_before" "$unconfined_before"

    sudo apt-get update
    sudo apt-get install --yes bubblewrap slirp4netns apparmor-profiles
    dpkg-query -W -f='${binary:Package} ${Version}\n' bubblewrap slirp4netns apparmor apparmor-profiles
    /usr/bin/bwrap --version
    printf 'Official profile: '
    sha256sum "$profile"
    printf 'Relevant profiles before loading:\n'
    sudo cat /sys/kernel/security/apparmor/profiles | awk '$1 ~ /^(bwrap|unpriv_bwrap)(\/\/|$)/ { print }'

    # Preserve direct evidence of the runner policy before loading the profile.
    if /usr/bin/bwrap --unshare-all --die-with-parent --new-session --ro-bind / / --proc /proc --dev /dev -- /bin/true > "$diagnostics/bwrap-before.log" 2>&1; then
      echo 'Before-profile namespace probe: passed'
    else
      echo 'Before-profile namespace probe: failed; applying the packaged compatibility profile.'
      cat "$diagnostics/bwrap-before.log"
      sudo journalctl -k --no-pager --since '5 minutes ago' --grep 'apparmor=.*DENIED.*comm="bwrap"' || true
    fi

    # Load this executable-specific, child-restricting profile only. Keep both
    # AppArmor sysctls and the producer's sandbox command unchanged.
    sudo apparmor_parser -r "$profile"
    printf 'Relevant profiles after loading:\n'
    sudo cat /sys/kernel/security/apparmor/profiles | awk '$1 ~ /^(bwrap|unpriv_bwrap)(\/\/|$)/ { print }'
    userns_after=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)
    unconfined_after=$(sysctl -n kernel.apparmor_restrict_unprivileged_unconfined)
    printf 'After: restrict_unprivileged_userns=%s restrict_unprivileged_unconfined=%s\n' "$userns_after" "$unconfined_after"
    if [[ "$userns_before" != "$userns_after" || "$unconfined_before" != "$unconfined_after" ]]; then
      echo 'AppArmor sysctl values changed during prerequisite setup; refusing to continue.' >&2
      return 1
    fi

    smoke=$(/usr/bin/bwrap --unshare-all --die-with-parent --new-session --ro-bind / / --proc /proc --dev /dev \
      --clearenv --setenv PATH /usr/bin:/bin --chdir / -- /bin/sh -eu -c '
        printf "child_profile="
        cat /proc/self/attr/current
        sed -n "s/^CapEff:[[:space:]]*/CapEff=/p" /proc/self/status
      ')
    printf '%s\n' "$smoke" | tee "$diagnostics/bwrap-after.log"
    local -a smoke_lines
    mapfile -t smoke_lines <<< "$smoke"
    if [[ "${#smoke_lines[@]}" != 2 || "${smoke_lines[0]}" != 'child_profile=bwrap//&unpriv_bwrap (enforce)' || "${smoke_lines[1]}" != CapEff=0000000000000000 ]]; then
      echo 'Sandbox smoke did not prove the enforced child profile and zero effective capabilities.' >&2
      return 1
    fi
    echo 'Sandbox prerequisites passed; provider sandbox assertions remain required.'
  } 2>&1 | tee "$diagnostics/diagnostics.log"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ao_sandbox_prerequisites
fi
