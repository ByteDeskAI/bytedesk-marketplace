#!/usr/bin/env bash
# Concurrent writes must not lose data.
#
# One store is shared by every git worktree of a project, and the whole point of
# `tm parallel` / `tm claim` / `tm worktree` is several sessions working at once. So
# "two processes write at the same instant" is the normal case, not a thought experiment.
#
# Every assertion here FAILED before the writes were serialized:
#   - 8 concurrent `tm task new` produced 8 files with 7 distinct ids and 6 index rows,
#     and the duplicate id made one file permanently unaddressable (`fileFor` resolves an
#     id to the first matching directory entry).
#   - 8 concurrent `tm comment` on one task stored 5 of 8, with 7 processes exiting 0.
#
# These must be REAL forked processes. A same-process test passes on withLock's
# reentrant heldDepth counter and proves nothing about cross-process safety.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
export CLAUDE_SESSION_ID="test-session"
unset TM_ENFORCE
trap 'rm -rf "$TM_ROOT"' EXIT

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
STORE="$TM_ROOT/.bytedesk/task-management"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
eq() { [[ "$1" == "$2" ]] && ok "$3" || no "$3" "expected $2, got $1"; }

echo "test-concurrency"

tm init >/dev/null
tm epic new "Concurrency" >/dev/null

# ── concurrent create: distinct ids, every file indexed ──────────────────────
N=8
for i in $(seq 1 $N); do
  # Distinct enough titles that the fuzzy duplicate guard does not refuse them.
  (TM_ALLOW_DUP=1 node "$PLUGIN_ROOT/bin/tm" task new "concurrent subject number $i" >/dev/null 2>&1) &
done
wait

FILES=$(find "$STORE/tasks" -name 'TM-*.md' | wc -l | tr -d ' ')
IDS=$(find "$STORE/tasks" -name 'TM-*.md' -exec basename {} \; | grep -o '^TM-[0-9]*' | sort -u | wc -l | tr -d ' ')
ROWS=$(tm board --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tasks.length))')

eq "$FILES" "$N" "$N concurrent creates write $N files"
eq "$IDS" "$N" "every concurrent create gets its own id"
eq "$ROWS" "$N" "index.json carries every concurrently created task"

# Every id must be addressable — a duplicate leaves one file unreachable forever.
UNREACHABLE=0
for f in "$STORE"/tasks/TM-*.md; do
  id=$(basename "$f" | grep -o '^TM-[0-9]*')
  tm show "$id" >/dev/null 2>&1 || UNREACHABLE=$((UNREACHABLE + 1))
done
eq "$UNREACHABLE" "0" "every task on disk is addressable by its id"

# And doctor must agree, rather than reporting index-drift it can 'fix' into silence.
tm doctor >/dev/null 2>&1 && ok "doctor is clean after concurrent creates" \
  || no "doctor is clean after concurrent creates" "$(tm doctor 2>&1 | head -3)"

# ── concurrent append to one task: no lost writes ────────────────────────────
tm task new "the comment target" >/dev/null
TARGET=$(tm find "the comment target" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].id))')

: > "$TM_ROOT/exits"
for i in $(seq 1 $N); do
  (node "$PLUGIN_ROOT/bin/tm" comment "$TARGET" "comment number $i" >/dev/null 2>&1; echo "$?" >> "$TM_ROOT/exits") &
done
wait

COMMENTS=$(tm show "$TARGET" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).comments||[]).length))')
NONZERO=$(grep -cv '^0$' "$TM_ROOT/exits" || true)

eq "$COMMENTS" "$N" "$N concurrent comments are all stored"
eq "$NONZERO" "0" "and no process reported a failure"

# ── concurrent appends to different fields of one task ───────────────────────
for i in $(seq 1 4); do
  (node "$PLUGIN_ROOT/bin/tm" ac "$TARGET" "criterion $i" >/dev/null 2>&1) &
  (node "$PLUGIN_ROOT/bin/tm" label "$TARGET" "label-$i" >/dev/null 2>&1) &
done
wait

AC=$(tm show "$TARGET" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).acceptance||[]).length))')
LABELS=$(tm show "$TARGET" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).labels||[]).length))')
eq "$AC" "4" "concurrent acceptance criteria are all kept"
eq "$LABELS" "4" "concurrent labels are all kept"

# ── concurrent touches: the highest-frequency writer in the plugin ───────────
# The PostToolUse hook calls this on every Edit and Write from every session, so it is
# the append most likely to race. 8 different files recorded at once must all survive.
for i in $(seq 1 $N); do
  (node "$PLUGIN_ROOT/bin/tm" touches "$TARGET" "src/module-$i.ts" >/dev/null 2>&1) &
done
wait
TOUCHES=$(tm show "$TARGET" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).touches||[]).length))')
eq "$TOUCHES" "$N" "$N concurrently recorded paths are all kept"

# ── one override token is spent exactly once ──────────────────────────────────
# `tm override` mints one token. Two gates consuming it concurrently must not both pass.
tm config wipLimit 1 >/dev/null
tm start "$TARGET" >/dev/null 2>&1
tm override "concurrent test" >/dev/null
: > "$TM_ROOT/starts"
for i in 1 2 3 4; do
  (TM_ALLOW_DUP=1 node "$PLUGIN_ROOT/bin/tm" task new "override race subject $i" >/dev/null 2>&1
   node "$PLUGIN_ROOT/bin/tm" start "TM-00$((i + 9))" >/dev/null 2>&1; echo "$?" >> "$TM_ROOT/starts") &
done
wait
USED=$(STORE="$STORE" node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.env.STORE + "/events.jsonl", "utf8").split("\n").filter(Boolean);
console.log(lines.filter((l) => { try { return JSON.parse(l).event === "override_used"; } catch { return false; } }).length);
')
[[ "$USED" -le 1 ]] && ok "one override token is consumed at most once" \
  || no "one override token is consumed at most once" "consumed $USED times"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
