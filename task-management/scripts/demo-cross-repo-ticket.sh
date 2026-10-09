#!/usr/bin/env bash
# Demo: a cross-repo ticket from repo A to repo B, end to end (TM-381, TM-357, TM-359; EP-028).
#
#   bash task-management/scripts/demo-cross-repo-ticket.sh
#
# Builds two throwaway repos with their own tm stores, files a CRITICAL ticket from A's task onto
# B's board, then plays B's progress and shows each event landing on A's task. agent-orchestration
# is always a stub here (it records what would have been mailed) so the demo never sends real mail,
# and both pools stay disabled so nothing real is dispatched. Everything is deleted on exit.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
A="$TMP/src/repo-a"
B="$TMP/src/repo-b"
MAIL="$TMP/mail.log"
mkdir -p "$A" "$B" "$TMP/home"
export HOME="$TMP/home" TM_PLUGIN_ROOT="$PLUGIN_ROOT" TM_NTFY_OFF=1 AGENT_ORCHESTRATION_STATE_HOME="$TMP/home/ao"
unset CLAUDE_PROJECT_DIR TM_ENFORCE
cat > "$TMP/ao-topology" <<EOF
#!/usr/bin/env bash
# stub agent-orchestration: record the mail instead of sending it
to=""; subject=""
while [[ \$# -gt 0 ]]; do case "\$1" in --to-repo) to="\$2"; shift ;; --subject) subject="\$2"; shift ;; esac; shift; done
echo "  [mail → lead of \$(basename "\$to")] \$subject" >> "$MAIL"
EOF
chmod +x "$TMP/ao-topology"
export TM_TOPOLOGY_BIN="$TMP/ao-topology"

tm() { local root="$1"; shift; (cd "$root" && TM_ROOT="$root" node "$PLUGIN_ROOT/bin/tm" "$@"); }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
mail() { [[ -f "$MAIL" ]] && cat "$MAIL" && : > "$MAIL" || echo "  (no mail)"; }
origin_comments() { tm "$A" show TM-001 --json | node -e 'for (const c of JSON.parse(require("fs").readFileSync(0,"utf8")).comments||[]) console.log("  [A TM-001 comment] " + c.text)'; }

step "two repos, each with its own board"
for r in "$A" "$B"; do
  tm "$r" init >/dev/null
  tm "$r" epic new "demo" >/dev/null
  tm "$r" config dispatch.enabled false >/dev/null # no real worker in a demo
done
tm "$A" task new "ship the report page" --body "needs a fix in repo-b" --ac "the page renders" | sed 's/^/  A: /'

step "A files a critical ticket on B, from its task TM-001"
tm "$A" ticket "$B" "Fix the export endpoint" --priority critical --ac "export returns 200" --from-task TM-001 | sed 's/^/  /'

step "the ticket on B's board, with its origin"
tm "$B" show TM-001 --json | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(`  ${t.id} ${t.title} — priority ${t.priority}\n  origin: ${JSON.stringify(t.origin)}`)'

step "B's lead was notified"
mail

step "B's pool was woken"
echo "  $(cat "$B/.bytedesk/task-management/pool.wake")  (a running pool consumes this within a second)"

step "A's task now waits on the ticket"
tm "$A" why TM-001 | sed 's/^/  /'

step "B makes progress; each event lands on A's task and mails A's lead"
tm "$B" ticket event TM-001 pr_opened https://github.com/example/repo-b/pull/42 >/dev/null
tm "$B" ticket event TM-001 review approved >/dev/null
tm "$B" ticket event TM-001 merged >/dev/null
tm "$B" ticket event TM-001 published v2.4.1 >/dev/null
origin_comments
mail

step "B closes the ticket; the done event reaches A through B's event bridge"
TM_ENFORCE=off tm "$B" done TM-001 | sed 's/^/  B: /'
for _ in $(seq 1 50); do tm "$A" show TM-001 --json | grep -q "repo-b#TM-001 done" && break; sleep 0.1; done
origin_comments | tail -1
mail

step "A's task is no longer blocked"
tm "$A" why TM-001 | sed 's/^/  /'
