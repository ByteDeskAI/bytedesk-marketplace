# Write GATEWAY_DIR/cutover.job.json + append cutover.log.ndjson so the live
# SPA can open the procedure console when deploy-safe runs outside POST /admin/api/cutover.
# Requires GATEWAY_DIR. Optional CUTOVER_JOB_ID.

cutover_job_file() {
  printf '%s/cutover.job.json' "${GATEWAY_DIR:?}"
}

cutover_log_file() {
  printf '%s/cutover.log.ndjson' "${GATEWAY_DIR:?}"
}

cutover_lock_dir() {
  printf '%s/cutover.lock' "${GATEWAY_DIR:?}"
}

cutover_lock_acquire() {
  mkdir -p "$GATEWAY_DIR"
  local dir pid
  dir="$(cutover_lock_dir)"
  if mkdir "$dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$dir/pid"
    CUTOVER_LOCK_HELD=1
    export CUTOVER_LOCK_HELD
    return 0
  fi
  pid="$(cat "$dir/pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$dir"
    if mkdir "$dir" 2>/dev/null; then
      printf '%s\n' "$$" >"$dir/pid"
      CUTOVER_LOCK_HELD=1
      export CUTOVER_LOCK_HELD
      return 0
    fi
  fi
  return 1
}

cutover_lock_release() {
  [[ "${CUTOVER_LOCK_HELD:-0}" == "1" ]] || return 0
  rm -rf "$(cutover_lock_dir)" 2>/dev/null || true
  CUTOVER_LOCK_HELD=0
  export CUTOVER_LOCK_HELD
}

_cutover_job_python() {
  if command -v python3 >/dev/null 2>&1; then
    python3 "$@"
  elif command -v python >/dev/null 2>&1; then
    python "$@"
  else
    return 1
  fi
}

# Resolve or mint a job id. Reuse an in-flight job so preflight→stage→restart
# share one console conversation.
cutover_job_resolve_id() {
  if [[ -n "${CUTOVER_JOB_ID:-}" ]]; then
    printf '%s\n' "$CUTOVER_JOB_ID"
    return 0
  fi
  local existing=""
  existing="$(_cutover_job_python - "$GATEWAY_DIR/cutover.job.json" <<'PY' 2>/dev/null || true
import json, sys, os
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        job = json.load(f)
except Exception:
    sys.exit(0)
st = str(job.get("status") or "")
if st in ("queued", "running", "bouncing", "unknown"):
    i = str(job.get("id") or "").strip()
    if i:
        print(i)
PY
)"
  if [[ -n "$existing" ]]; then
    printf '%s\n' "$existing"
    return 0
  fi
  printf 'co-%s\n' "$(date +%s%N 2>/dev/null || date +%s)"
}

cutover_job_init() {
  local mode="${1:-restart-cutover}"
  mkdir -p "$GATEWAY_DIR"
  CUTOVER_JOB_ID="$(cutover_job_resolve_id)"
  export CUTOVER_JOB_ID
  CUTOVER_JOB_ACTIVE=1
  export CUTOVER_JOB_ACTIVE
  cutover_job_write "running" "cutover ${mode}" "$mode" "running"
}

cutover_job_write() {
  local job_status="${1:-running}"
  local message="${2:-}"
  local step="${3:-}"
  local step_status="${4:-}"
  [[ "${CUTOVER_JOB_ACTIVE:-0}" == "1" ]] || [[ -n "${CUTOVER_JOB_ID:-}" ]] || return 0
  local id="${CUTOVER_JOB_ID:-}"
  [[ -n "$id" ]] || return 0
  CUTOVER_JOB_STATUS="$job_status" CUTOVER_JOB_MESSAGE="$message" \
    CUTOVER_JOB_STEP="$step" CUTOVER_JOB_STEP_STATUS="$step_status" \
    CUTOVER_JOB_EVIDENCE="${CUTOVER_JOB_EVIDENCE:-}" \
    _cutover_job_python - "$(cutover_job_file)" "$id" "${CUTOVER_JOB_MODE:-restart-cutover}" <<'PY' || return 0
import json, os, sys
from datetime import datetime, timezone
path, job_id, mode = sys.argv[1], sys.argv[2], sys.argv[3]
job = {}
try:
    with open(path, encoding="utf-8") as f:
        job = json.load(f) or {}
except Exception:
    job = {}
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
if not job.get("requestedAt"):
    job["requestedAt"] = now
job["id"] = job_id
job["mode"] = mode
job["viaAgent"] = True
job["status"] = os.environ.get("CUTOVER_JOB_STATUS") or job.get("status") or "running"
job["message"] = os.environ.get("CUTOVER_JOB_MESSAGE") or job.get("message") or ""
job["updatedAt"] = now
ev = os.environ.get("CUTOVER_JOB_EVIDENCE") or ""
if ev:
    job["evidencePath"] = ev
step = (os.environ.get("CUTOVER_JOB_STEP") or "").strip()
st = (os.environ.get("CUTOVER_JOB_STEP_STATUS") or "").strip()
if step:
    steps = list(job.get("steps") or [])
    found = False
    for s in steps:
        if s.get("name") == step:
            s["status"] = st or s.get("status") or "running"
            found = True
            break
    if not found:
        steps.append({"name": step, "status": st or "running"})
    job["steps"] = steps
if job.get("status") == "passed":
    for s in job.get("steps") or []:
        if s.get("status") in ("running", "pending", "", "bouncing", "unknown"):
            s["status"] = "passed"
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(job, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
PY
}

cutover_job_log() {
  local step="${1:-}"
  local text="${2:-}"
  [[ -n "$text" ]] || return 0
  [[ -n "${CUTOVER_JOB_ID:-}" ]] || return 0
  _cutover_job_python - "$(cutover_log_file)" "$CUTOVER_JOB_ID" "$step" "$text" <<'PY' || return 0
import json, os, sys
from datetime import datetime, timezone
path, job_id, step, text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
seq = 0
try:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if int(rec.get("seq") or 0) > seq:
                    seq = int(rec["seq"])
            except Exception:
                continue
except FileNotFoundError:
    pass
seq += 1
rec = {
    "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "jobId": job_id,
    "seq": seq,
    "step": step,
    "stream": "stdout",
    "text": text[:2000],
}
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
with open(path, "a", encoding="utf-8") as f:
    f.write(json.dumps(rec) + "\n")
PY
}

cutover_job_mark_applied() {
  mkdir -p "$GATEWAY_DIR"
  printf 'APPLIED\n' >"$GATEWAY_DIR/stage.result"
  rm -f "$GATEWAY_DIR/deploy.stamp"
  local bin="${GATEWAY_BIN:-$GATEWAY_DIR/bytedesk-emote-gateway}"
  CUTOVER_JOB_BIN="$bin" _cutover_job_python - "$GATEWAY_DIR/cutover.last-pass.json" "${CUTOVER_JOB_ID:-}" "${CUTOVER_JOB_MODE:-restart-cutover}" <<'PY' || true
import hashlib, json, os, sys
from datetime import datetime, timezone
path, job_id, mode = sys.argv[1], sys.argv[2], sys.argv[3]
h = ""
binpath = os.environ.get("CUTOVER_JOB_BIN") or ""
try:
    with open(binpath, "rb") as f:
        h = hashlib.sha256(f.read()).hexdigest()[:16]
except Exception:
    pass
rec = {
    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "hash": h,
    "mode": mode,
    "jobId": job_id,
    "viaAgent": True,
}
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(rec, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
PY
}

cutover_job_pass() {
  local message="${1:-cutover passed}"
  local evidence="${2:-}"
  CUTOVER_JOB_EVIDENCE="$evidence" cutover_job_write "passed" "$message" "postflight" "passed"
  cutover_job_log "postflight" "$message"
  cutover_job_mark_applied
}

# Bind to an existing failed/in-flight job for timeout-then-healthy recovery.
# Never mints an id — casual postflight with no job (or an already-passed job)
# is a no-op.
cutover_job_heal_id() {
  if [[ -n "${CUTOVER_JOB_ID:-}" ]]; then
    printf '%s\n' "$CUTOVER_JOB_ID"
    return 0
  fi
  _cutover_job_python - "$GATEWAY_DIR/cutover.job.json" <<'PY' 2>/dev/null || true
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        job = json.load(f)
except Exception:
    sys.exit(0)
st = str(job.get("status") or "")
if st in ("queued", "running", "bouncing", "unknown", "failed"):
    i = str(job.get("id") or "").strip()
    if i:
        print(i)
PY
}

# Close a failed/in-flight job after standalone postflight probes pass.
# Does not require CUTOVER_JOB_ID; does not mint a new job.
cutover_job_finish_postflight() {
  local evidence="${1:-}"
  local id
  id="$(cutover_job_heal_id)"
  [[ -n "$id" ]] || return 0
  CUTOVER_JOB_ID="$id"
  export CUTOVER_JOB_ID
  CUTOVER_JOB_ACTIVE=1
  export CUTOVER_JOB_ACTIVE
  cutover_job_pass "postflight PASS" "$evidence"
}

cutover_job_fail() {
  local message="${1:-cutover failed}"
  cutover_job_write "failed" "$message"
  cutover_job_log "error" "$message"
}

cutover_job_bounce() {
  cutover_job_write "bouncing" "restarting live unit" "restart-cutover" "running"
  cutover_job_log "restart-cutover" "bouncing live process"
}
