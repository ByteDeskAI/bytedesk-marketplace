#!/usr/bin/env bash
# EP-028 demo: reliable agent comms, cross-repo tickets, autonomous delivery.
#
# Safe to run on a live machine. Every board, mailbox and tmux server it touches is a temp copy:
# HOME is a temp dir, AGENT_ORCHESTRATION_SERVICES=0, TMUX is cleared, and nothing is pushed,
# deployed or mailed. The only real data read is this machine's Claude transcripts (step 1, read-only).
#
#   bash docs/demo/ep-028-demo.sh            # all steps
#   bash docs/demo/ep-028-demo.sh 3          # one step
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TM="$ROOT/task-management"
AO="$ROOT/agent-orchestration"
REAL_HOME="$HOME"
ONLY="${1:-}"
B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; R=$'\e[31m'; N=$'\e[0m'

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home" TMUX="" TMUX_TMPDIR="$SANDBOX/tmux" AGENT_ORCHESTRATION_SERVICES=0 AO_TRANSPORT=file
mkdir -p "$HOME" "$TMUX_TMPDIR"
git config --global user.email demo@example.invalid; git config --global user.name demo

step() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
title() { printf '\n%s━━ %s. %s%s\n%s%s%s\n' "$B" "$1" "$2" "$N" "$D" "$3" "$N"; }
tm() { (cd "$STORE" && TM_ROOT="$STORE" node "$TM/bin/tm" "$@"); }
# Run named unit tests and print each behaviour as a pass/fail line: the tests ARE the proof.
proof() {
  local dir="$1"; shift
  local pre=()
  [ "$dir" = "$AO" ] && pre=(--import ./tests/helpers/tmux-preflight.mjs --import ./tests/unit/register-file-transport.mjs)
  (cd "$dir" && node "${pre[@]}" --test --test-concurrency=1 --test-reporter=spec "$@" 2>&1) \
    | grep -E '^\s*(✔|✖)' | grep -vE '^\s*(✔|✖) .*\.test\.mjs|failing tests' \
    | sed -E "s/ \([0-9.]+m?s\)$//; s/^\s*✔/  ${G}✔${N}/; s/^\s*✖/  ${R}✖${N}/" | awk '!seen[$0]++' | head -"${LIMIT:-14}"
}

# The real repository (not this worktree), so step 1 finds this repo's transcripts.
REPO="$(cd "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
# AO's tests need its node_modules; a fresh worktree has none.
[ -d "$AO/node_modules" ] || (cd "$AO" && npm ci --no-audit --no-fund --silent >/dev/null 2>&1)

# A throwaway board for steps that need one.
STORE="$SANDBOX/repo"
mkdir -p "$STORE" && (cd "$STORE" && git init -q && git commit -q --allow-empty -m init)
tm init >/dev/null 2>&1
tm epic new "Demo epic" >/dev/null 2>&1

if step 1; then
  title 1 "enhance-mine finds problems in real transcripts" "Mines this machine's Claude transcripts for this repo (read-only, secrets redacted), clusters them, and shows what it would file. Dry-run: nothing is written."
  (cd "$STORE" && HOME="$REAL_HOME" TM_ROOT="$STORE" node "$TM/bin/tm" enhance-mine --project "$REPO" --days 7 --top 8) 2>&1 | sed -n '1,40p'
fi

if step 2; then
  title 2 "A cross-repo ticket, end to end" "Repo A files a critical ticket on repo B's board. B's lead is mailed and B's pool is woken; A's task waits; B's progress lands back on A."
  bash "$TM/scripts/demo-cross-repo-ticket.sh" 2>&1
fi

if step 3; then
  title 3 "Messages that arrive" "Standing mail rings the recipient's pane, mailbox wait blocks on the reply, every session has an identity, and nobody can send as someone else."
  LIMIT=18 proof "$AO" tests/unit/standing-mail-ring.test.mjs tests/unit/topology-mailbox-send.test.mjs tests/unit/topology-session-identity.test.mjs
fi

if step 4; then
  title 4 "Leads that are not 'unresponsive' just because they are busy" "A hook heartbeat proves a busy lead is alive; lead status --cached answers without probing; held mail can launch a missing lead."
  LIMIT=10 proof "$AO" tests/unit/topology-lead-liveness.test.mjs
fi

if step 5; then
  title 5 "The queue: expedite lane, retries, claims that survive, one dispatch guard" "Critical work jumps the WIP limit; task failures retry with backoff; live workers keep their claims; no task gets two workers."
  LIMIT=16 proof "$TM" --test-name-pattern="TM-358|TM-363|TM-362|expedite|retry|renew|dead worker|normal-priority" tests/unit/pool.test.mjs tests/unit/result.test.mjs
  printf '\n  %stm dispatch-check on a fresh task:%s\n' "$D" "$N"
  tm task new "Demo task" --body "x" --ac "y" >/dev/null 2>&1
  tm dispatch-check TM-001 2>&1 | sed 's/^/    /'
  printf '\n  %stm pool wait (no sleep loops — blocks until the condition or times out):%s\n' "$D" "$N"
  tm pool wait --until stopped --timeout 3 2>&1 | sed 's/^/    /'
fi

if step 6; then
  title 6 "Finished work never sits unnoticed" "tm review-sweep lists done work with no review verdict and idle PRs; the AO supervisor runs it and notifies the lead exactly once."
  tm review-sweep 2>&1 | sed 's/^/    /' | head -20
  LIMIT=6 proof "$AO" tests/unit/topology-review-sweep.test.mjs
fi

if step 7; then
  title 7 "Reviews that do not scrape the screen" "Reviewers submit a JSON verdict through a verb; the lead reads the record. Reviews read the worker's worktree; minor findings do not block."
  LIMIT=12 proof "$AO" tests/unit/topology-reviewer*.test.mjs
fi

if step 8; then
  title 8 "MCP parity and secrets that reach workers safely" "New MCP tools for run mail, lead status and handoff; declared secrets reach workers without touching argv, logs or tmux's environment."
  LIMIT=12 proof "$AO" tests/unit/mcp-parity.test.mjs tests/unit/topology-pass-env.test.mjs
fi

if step 9; then
  title 9 "Doctor: is my installed plugin stale?" "Compares the installed plugin with origin/main and names the update command."
  (HOME="$REAL_HOME" node "$AO/bin/agent-orchestration" doctor --json 2>/dev/null || true) \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const f=j.pluginFreshness??j.freshness??j;console.log(JSON.stringify(f,null,2).split("\n").slice(0,14).map(l=>"    "+l).join("\n"))}catch{console.log("    (doctor output not JSON on this build)")}})'
fi

printf '\n%sDone.%s Sandbox removed; nothing outside it was changed.\n' "$B" "$N"
