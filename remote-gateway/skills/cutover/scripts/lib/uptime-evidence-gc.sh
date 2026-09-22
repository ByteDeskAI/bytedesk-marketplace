# _uptime_evidence janitor for deploy-safe.
# Sourced after EVIDENCE_DIR and GATEWAY_DIR are set.
#
# On first sweeper start: delete leftover evidence files in EVIDENCE_DIR.
# Every hour (or EVIDENCE_MAX_AGE_MIN): delete regular files older than that age.
# Dotfiles (.gc.pid leftovers, etc.) are left alone.
#
# Env:
#   EVIDENCE_GC           default 1 — set 0 to disable
#   EVIDENCE_MAX_AGE_MIN  default 60

uptime_evidence_gc_enabled() {
  [[ "${EVIDENCE_GC:-1}" == "1" ]]
}

uptime_evidence_max_age_min() {
  local n="${EVIDENCE_MAX_AGE_MIN:-60}"
  if [[ "$n" =~ ^[0-9]+$ ]] && (( n > 0 )); then
    printf '%s\n' "$n"
    return 0
  fi
  printf '%s\n' "60"
}

# Remove regular files older than EVIDENCE_MAX_AGE_MIN. No-op if dir missing.
prune_uptime_evidence() {
  uptime_evidence_gc_enabled || return 0
  local dir="${1:-${EVIDENCE_DIR:-}}"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  local max_min
  max_min="$(uptime_evidence_max_age_min)"
  find "$dir" -mindepth 1 -maxdepth 1 -type f ! -name '.*' -mmin +"$max_min" -delete 2>/dev/null || true
}

# Wipe leftover regular files (used once when the hourly sweeper starts).
clear_uptime_evidence() {
  uptime_evidence_gc_enabled || return 0
  local dir="${1:-${EVIDENCE_DIR:-}}"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -type f ! -name '.*' -delete 2>/dev/null || true
}

uptime_evidence_gc_pidfile() {
  printf '%s\n' "${GATEWAY_DIR:-${HOME:-/tmp}/.bytedesk-emote-gateway}/uptime-evidence-gc.pid"
}

# If no sweeper is running for this host, clear the dir once and start an hourly prune loop.
ensure_uptime_evidence_sweeper() {
  uptime_evidence_gc_enabled || return 0
  local dir="${EVIDENCE_DIR:-}"
  [[ -n "$dir" ]] || return 0
  mkdir -p "$dir" "${GATEWAY_DIR:-$(dirname "$(uptime_evidence_gc_pidfile)")}" 2>/dev/null || true
  local pidfile
  pidfile="$(uptime_evidence_gc_pidfile)"
  if [[ -f "$pidfile" ]]; then
    local old
    old="$(tr -d ' \n' <"$pidfile" 2>/dev/null || true)"
    if [[ "$old" =~ ^[0-9]+$ ]] && kill -0 "$old" 2>/dev/null; then
      return 0
    fi
  fi
  local max_min
  max_min="$(uptime_evidence_max_age_min)"
  clear_uptime_evidence "$dir"
  # Detached so deploy-safe EXIT (shadow cleanup) does not take the janitor with it.
  nohup bash -c '
    set +e
    pidfile="$1"
    dir="$2"
    max_min="$3"
    echo $$ >"$pidfile"
    while true; do
      sleep $((max_min * 60))
      if [[ -d "$dir" ]]; then
        find "$dir" -mindepth 1 -maxdepth 1 -type f ! -name ".*" -mmin +"$max_min" -delete 2>/dev/null
      fi
    done
  ' uptime-evidence-gc "$pidfile" "$dir" "$max_min" >/dev/null 2>&1 &
}

# Call once from deploy-safe after mkdir EVIDENCE_DIR.
init_uptime_evidence() {
  uptime_evidence_gc_enabled || return 0
  mkdir -p "${EVIDENCE_DIR:-}" 2>/dev/null || true
  prune_uptime_evidence
  ensure_uptime_evidence_sweeper
}
