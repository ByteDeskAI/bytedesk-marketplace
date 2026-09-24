#!/usr/bin/env bash
# CAP-0038: attach cutover PASS evidence paths to capability cards via `tm evidence`.
#
# Scans _uptime_evidence/postflight-*.txt (optionally preflight/stage/shadow) for
# PASS lines and attaches matching paths to CAP cards. Idempotent: skips paths
# already listed on the card. Never opens control.env, config.json, or session stores.
#
# Usage (repo root or monorepo checkout):
#   scripts/attach-cutover-evidence.sh [--dry-run] [--include-preflight] [--include-stage]
#                                      [--evidence-dir DIR] [CAP-id ...]
#
# Defaults: when CAP-0026 / CAP-0035 cards are still open (or in_progress), they are
# included; any CAP ids passed on the CLI are always included.
set -euo pipefail

DRY_RUN=0
INCLUDE_PREFLIGHT=0
INCLUDE_STAGE=0
CLI_EVIDENCE_DIR=""
declare -a CLI_CAPS=()

usage() {
  cat <<'EOF'
Usage: attach-cutover-evidence.sh [options] [CAP-id ...]

  Scan cutover evidence files for PASS lines and attach their paths to CAP cards
  with `tm evidence` (idempotent). Never reads control.env or config.json.

Options:
  --dry-run              Print planned tm evidence commands; do not write
  --include-preflight    Also scan preflight-*.txt
  --include-stage        Also scan stage-*.txt and shadow-*.txt
  --evidence-dir DIR     Evidence directory (default: $EVIDENCE_DIR env or
                         <repo>/_uptime_evidence)
  -h, --help             Show this help

CAP targets:
  CLI CAP ids are always included. CAP-0026 and CAP-0035 are added automatically
  only when their cards are open or in_progress under the task-management store.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --include-preflight) INCLUDE_PREFLIGHT=1; shift ;;
    --include-stage) INCLUDE_STAGE=1; shift ;;
    --evidence-dir)
      [[ $# -ge 2 ]] || { echo "missing value for --evidence-dir" >&2; exit 2; }
      CLI_EVIDENCE_DIR="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do CLI_CAPS+=("$1"); shift; done
      break
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    CAP-[0-9][0-9][0-9][0-9])
      CLI_CAPS+=("$1")
      shift
      ;;
    *)
      echo "not a CAP id (want CAP-NNNN): $1" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve the gateway checkout (this script may live in the plugin or in setup/skills).
find_repo_root() {
  local d="$1"
  while [[ -n "$d" && "$d" != "/" ]]; do
    if [[ -d "$d/.bytedesk/task-management/capabilities" ]] || [[ -f "$d/go.mod" && -d "$d/scripts" ]]; then
      printf '%s\n' "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

REPO_ROOT="$(find_repo_root "$SCRIPT_DIR" || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  REPO_ROOT="$(find_repo_root "$(pwd)" || true)"
fi
if [[ -z "${REPO_ROOT}" ]]; then
  echo "error: cannot locate repo root (need .bytedesk/task-management or go.mod + scripts/)" >&2
  exit 1
fi

# Match tm store discovery: worktrees share the main checkout's .bytedesk store
# (git --git-common-dir). Reading CAP cards from a worktree-local copy would miss
# evidence that tm already attached.
main_checkout() {
  local dir="$1"
  python3 - "$dir" <<'PY'
import os, subprocess, sys
d = sys.argv[1]
try:
    common = subprocess.check_output(
        ["git", "-C", d, "rev-parse", "--git-common-dir"],
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip()
except Exception:
    print(os.path.realpath(d))
    raise SystemExit(0)
print(os.path.dirname(os.path.realpath(os.path.join(d, common))))
PY
}

STORE_ROOT="$(main_checkout "$REPO_ROOT")"
CAP_DIR="$STORE_ROOT/.bytedesk/task-management/capabilities"

# Evidence dir: --evidence-dir > env EVIDENCE_DIR > <checkout>/_uptime_evidence
if [[ -n "$CLI_EVIDENCE_DIR" ]]; then
  EVIDENCE_DIR="$CLI_EVIDENCE_DIR"
elif [[ -n "${EVIDENCE_DIR:-}" ]]; then
  : # keep caller/deploy-safe env
else
  EVIDENCE_DIR="$REPO_ROOT/_uptime_evidence"
fi

log() { printf '%s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*" >&2; }

cap_card_path() {
  local id="$1"
  local f
  f="$(find "$CAP_DIR" -maxdepth 1 -type f -name "${id}-*.md" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$f" && -f "$CAP_DIR/${id}.md" ]]; then
    f="$CAP_DIR/${id}.md"
  fi
  [[ -n "$f" ]] || return 1
  printf '%s\n' "$f"
}

cap_status() {
  local card="$1"
  sed -n '1,40p' "$card" | sed -n 's/^status:[[:space:]]*"\?\([^"]*\)"\?/\1/p' | head -n 1
}

cap_is_openish() {
  local id="$1" card st
  card="$(cap_card_path "$id" 2>/dev/null || true)"
  [[ -n "$card" ]] || return 1
  st="$(cap_status "$card")"
  case "$st" in
    open|in_progress) return 0 ;;
    *) return 1 ;;
  esac
}

# True if path (or its basename / store copy) is already on the CAP evidence list.
already_attached() {
  local id="$1" path="$2"
  local card base
  card="$(cap_card_path "$id" 2>/dev/null || true)"
  [[ -n "$card" ]] || return 1
  base="$(basename "$path")"
  python3 - "$card" "$path" "$base" "$id" <<'PY'
import json, re, sys

card, path, base, cap_id = sys.argv[1:5]
text = open(card, encoding="utf-8").read()
m = re.search(r"^evidence:\s*(\[.*\])\s*$", text, re.M)
if not m:
    sys.exit(1)
raw = m.group(1).strip()
try:
    arr = json.loads(raw)
except Exception:
    arr = re.findall(r'"([^"]+)"', raw)

needles = {
    path,
    base,
    f"evidence/{cap_id}-{base}",
    f".bytedesk/task-management/evidence/{cap_id}-{base}",
}
for e in arr:
    e = str(e)
    if e in needles:
        sys.exit(0)
    leaf = e.rsplit("/", 1)[-1]
    if leaf == base or leaf == f"{cap_id}-{base}":
        sys.exit(0)
    if e.endswith("/" + base) or e.endswith(cap_id + "-" + base):
        sys.exit(0)
sys.exit(1)
PY
}

file_has_pass_line() {
  local f="$1"
  # Match deploy-safe "postflight PASS …" / fixtures; avoid matching passwords.
  grep -qE '(^|[[:space:]])PASS([[:space:]]|:|$)' "$f" 2>/dev/null
}

collect_pass_files() {
  local -a patterns=(postflight-*.txt)
  if [[ "$INCLUDE_PREFLIGHT" == "1" ]]; then
    patterns+=(preflight-*.txt)
  fi
  if [[ "$INCLUDE_STAGE" == "1" ]]; then
    patterns+=(stage-*.txt shadow-*.txt)
  fi
  if [[ ! -d "$EVIDENCE_DIR" ]]; then
    warn "evidence dir missing: $EVIDENCE_DIR"
    return 0
  fi
  local pat f
  shopt -s nullglob
  for pat in "${patterns[@]}"; do
    for f in "$EVIDENCE_DIR"/$pat; do
      [[ -f "$f" ]] || continue
      if file_has_pass_line "$f"; then
        printf '%s\n' "$f"
      fi
    done
  done
  shopt -u nullglob
}

build_targets() {
  declare -A seen=()
  local id
  for id in "${CLI_CAPS[@]+"${CLI_CAPS[@]}"}"; do
    seen["$id"]=1
  done
  for id in CAP-0026 CAP-0035; do
    if cap_is_openish "$id"; then
      seen["$id"]=1
    fi
  done
  local k
  for k in "${!seen[@]}"; do
    printf '%s\n' "$k"
  done | LC_ALL=C sort -u
}

if [[ ! -d "$CAP_DIR" ]]; then
  warn "no capability store at $CAP_DIR — nothing to attach"
  exit 0
fi

mapfile -t PASS_FILES < <(collect_pass_files | LC_ALL=C sort -u)
mapfile -t TARGETS < <(build_targets)

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  log "no CAP targets (pass CAP-ids on CLI, or open CAP-0026/CAP-0035)"
  exit 0
fi

if [[ ${#PASS_FILES[@]} -eq 0 ]]; then
  extra=""
  [[ "$INCLUDE_PREFLIGHT" == "1" ]] && extra+=", preflight-*.txt"
  [[ "$INCLUDE_STAGE" == "1" ]] && extra+=", stage/shadow-*.txt"
  log "no PASS evidence files under $EVIDENCE_DIR (postflight-*.txt${extra})"
  exit 0
fi

log "repo=$REPO_ROOT"
log "store=$STORE_ROOT"
log "evidence_dir=$EVIDENCE_DIR"
log "targets=${TARGETS[*]}"
log "pass_files=${#PASS_FILES[@]}"

HAVE_TM=0
if command -v tm >/dev/null 2>&1; then
  HAVE_TM=1
else
  warn "tm not on PATH — printing instructions only"
fi

planned=0
attached=0
skipped=0

for cap in "${TARGETS[@]}"; do
  if ! cap_card_path "$cap" >/dev/null 2>&1; then
    warn "skip $cap: no capability card under $CAP_DIR"
    continue
  fi
  for path in "${PASS_FILES[@]}"; do
    rel="$path"
    case "$path" in
      "$REPO_ROOT"/*) rel="${path#"$REPO_ROOT"/}" ;;
    esac
    if already_attached "$cap" "$path"; then
      log "skip already attached: $cap <- $rel"
      skipped=$((skipped + 1))
      continue
    fi
    planned=$((planned + 1))
    if [[ "$DRY_RUN" == "1" ]]; then
      log "DRY-RUN: tm evidence $cap $path"
      continue
    fi
    if [[ "$HAVE_TM" != "1" ]]; then
      log "manual: tm evidence $cap $path"
      continue
    fi
    # Run from store root so tm finds the shared board; never touch secrets files.
    if (
      cd "$STORE_ROOT"
      # Prefer absolute path so copy works regardless of cwd.
      tm evidence "$cap" "$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
    ); then
      log "attached: $cap <- $rel"
      attached=$((attached + 1))
    else
      warn "tm evidence failed: $cap $path"
    fi
  done
done

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry-run complete: planned=$planned skipped=$skipped"
elif [[ "$HAVE_TM" != "1" ]]; then
  log "tm missing: planned_manual=$planned skipped=$skipped"
  log "install tm (task-management plugin) or add it to PATH, then re-run."
else
  log "done: attached=$attached skipped=$skipped"
fi

exit 0
