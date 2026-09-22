# Wait until the live gateway unit is active AND loopback /healthz succeeds.
# systemd reports active as soon as the main PID exists; HTTP :8443 is bound
# only after restoreTerminalTabs() (often well past 20s, and past 120s with
# ~23 live terminals on a busy host).
#
# Env:
#   RESTART_READY_ATTEMPTS  default 480  (240s at 0.5s; 23+ terminals bind late)
#   RESTART_READY_SLEEP     default 0.5
# Requires: unit_active, live_healthz. Optional: log.

wait_live_ready() {
  local attempts="${RESTART_READY_ATTEMPTS:-480}"
  local delay="${RESTART_READY_SLEEP:-0.5}"
  local i st hz="fail"
  if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    attempts=480
  fi
  for i in $(seq 1 "$attempts"); do
    st="$(unit_active "${GATEWAY_UNIT:-}")"
    hz="fail"
    if live_healthz >/dev/null 2>&1; then
      hz="ok"
    fi
    if [[ "$st" == "active" && "$hz" == "ok" ]]; then
      if declare -F log >/dev/null 2>&1; then
        log "live ready after ${i} attempts"
      fi
      if declare -F cutover_job_log >/dev/null 2>&1; then
        cutover_job_log "start" "live ready after ${i} attempts unit=${st} healthz=${hz}" 2>/dev/null || true
      fi
      return 0
    fi
    # ~1 Hz ticks at the default 0.5s sleep (every 2nd attempt).
    if (( i == 1 || i % 2 == 0 )); then
      if declare -F cutover_job_log >/dev/null 2>&1; then
        cutover_job_log "start" "wait tick ${i}/${attempts} unit=${st} healthz=${hz}" 2>/dev/null || true
      fi
    fi
    sleep "$delay"
  done
  return 1
}
