#!/usr/bin/env bash
# Resolve a design authority, verify it conforms, and report exactly how it was found.
#
# Exists because resolution used to guess. Across one evaluation sweep, seven runs on the
# same machine against the same repository produced two different answers — five adopted it
# via a directory-name convention, two correctly refused to reach a repo they could see but
# could not legitimately resolve. The only variable was the working directory.
#
# So: no guessing. An explicit argument or a committed .design-authority file, or nothing.
# Anything found by looking around is REPORTED as a candidate, never adopted.
#
# Usage: authority-doctor.sh [--authority <path>] [--start <dir>]
# Exit:  0 connected · 1 found but not conforming · 2 nothing configured

set -uo pipefail
AUTH=""; START="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --authority) AUTH="${2:-}"; shift 2 ;;
    --start)     START="${2:-$PWD}"; shift 2 ;;
    *) echo "authority-doctor: unknown argument $1" >&2; exit 64 ;;
  esac
done

ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
no(){ printf '  \033[31m✗\033[0m %s\n' "$1"; }
info(){ printf '    %s\n' "$1"; }

RULE=""
# 1 — explicit argument. Highest precedence, and still verified below.
[ -n "$AUTH" ] && RULE="--authority argument"

# 2 — a committed .design-authority, searched from START upward to the repo root. Committed
#     so every clone and every teammate resolves identically, which is the entire point.
if [ -z "$AUTH" ]; then
  d="$START"
  while [ "$d" != "/" ]; do
    if [ -f "$d/.design-authority" ]; then
      raw=$(grep -iE '^[[:space:]]*path[[:space:]]*:' "$d/.design-authority" | head -1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '"'"'"'')
      if [ -n "$raw" ]; then
        case "$raw" in /*) AUTH="$raw" ;; *) AUTH="$(cd "$d" && cd "$raw" 2>/dev/null && pwd)" ;; esac
        RULE=".design-authority ($d/.design-authority)"
      else
        repo=$(grep -iE '^[[:space:]]*repo[[:space:]]*:' "$d/.design-authority" | head -1 | sed 's/^[^:]*:[[:space:]]*//')
        [ -n "$repo" ] && { echo "AUTHORITY: not-cloned"; echo; no ".design-authority names a remote that is not cloned locally"
          info "repo: $repo"; info "clone it, then set  path: <local path>  in .design-authority"; exit 1; }
      fi
      break
    fi
    d=$(dirname "$d")
  done
fi

if [ -z "$AUTH" ] || [ ! -d "$AUTH" ]; then
  echo "AUTHORITY: none"; echo
  no "No design authority is configured for this repository."
  echo
  info "Nothing was adopted by guessing, deliberately — a repo found by directory name is"
  info "as likely to be the wrong one, and that failure surfaces weeks later as wrong colours."
  echo
  # Candidates are PROPOSED. Never adopted.
  found=0
  for c in "$START/../"*/ "$HOME"/*/ ; do
    [ -d "$c" ] || continue
    if [ -f "${c}DESIGN.md" ] && ls "$c"tokens/*.json >/dev/null 2>&1; then
      [ $found -eq 0 ] && { info "These look like design authorities, but none was used:"; found=1; }
      info "  $(cd "$c" && pwd)"
    fi
  done
  echo
  info "To connect one:   printf 'path: <path-to-authority>\\n' > .design-authority"
  info "To create one:    run the bytedesk-designer-authority skill"
  exit 2
fi

AUTH="$(cd "$AUTH" && pwd)"
echo "AUTHORITY: $AUTH"
echo "RESOLVED-BY: $RULE"
echo
ok "Resolved via $RULE"

fail=0
# --- required ---
[ -f "$AUTH/DESIGN.md" ] && ok "DESIGN.md" || { no "DESIGN.md missing — the foundation and the generated-art contract live here"; fail=1; }
if ls "$AUTH"/tokens/*.json >/dev/null 2>&1; then
  ok "token file: $(cd "$AUTH" && ls tokens/*.json | head -1)"
else
  no "no tokens/*.json — values must be authored somewhere machine-readable"; fail=1
fi

# --- pinnable: a run six months old cannot be explained without a sha ---
if git -C "$AUTH" rev-parse --short HEAD >/dev/null 2>&1; then
  sha=$(git -C "$AUTH" rev-parse --short HEAD)
  dirty=$(git -C "$AUTH" status --porcelain | wc -l)
  ok "git, pinnable at $sha"
  [ "$dirty" -gt 0 ] && info "note: $dirty uncommitted change(s) — runs will pin a sha that does not describe what they read"
else
  no "not a git repository — runs cannot pin which version they read"; fail=1
fi

# --- optional: absence degrades, it does not break ---
[ -f "$AUTH/catalog.json" ] && ok "catalog.json" || info "no catalog.json — products discovered from the directory instead"
[ -d "$AUTH/profiles" ] && ok "profiles/ ($(ls -1 "$AUTH/profiles" 2>/dev/null | wc -l) products)" || info "no profiles/ — every product inherits the foundation directly"
if [ -f "$AUTH/scripts/validate.mjs" ]; then
  if command -v node >/dev/null 2>&1; then
    if node "$AUTH/scripts/validate.mjs" >/dev/null 2>&1; then ok "its own validator passes"
    else
      # Internally inconsistent values are worse than absent ones: every stage will read them
      # confidently and produce work that is wrong in a way no downstream gate can see.
      no "its own validator FAILS — its values disagree with each other; fix the authority first"
      fail=1
    fi
  else ok "validate.mjs present (node not installed, not run)"; fi
else info "no scripts/validate.mjs — nothing gates this authority against itself"; fi
grep -qiE '^#+ .*generated art' "$AUTH/DESIGN.md" 2>/dev/null && ok "generated-art contract" \
  || info "no generated-art section — the suite will propose one rather than assume"

echo
[ $fail -eq 0 ] && { echo "CONNECTED"; exit 0; }
echo "NOT-CONFORMING"; exit 1
