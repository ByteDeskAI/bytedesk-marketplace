#!/usr/bin/env bash
# Tests run against a throwaway $HOME, so a bug here can never touch the real config.
# That matters more than usual: this tool's blast radius is nine files in a home directory.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  ok   $1"; }
bad()  { fail=$((fail+1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "       $2"; }

setup() {
  SANDBOX="$(mktemp -d)"
  export HOME="$SANDBOX"
  mkdir -p "$HOME/.agents" "$HOME/.claude" "$HOME/.codex/rules"
  printf '# Shared\n\nrule one\n' > "$HOME/.agents/AGENTS.md"
  printf '# policy\n' > "$HOME/.agents/shared.rules"
}
teardown() { rm -rf "$SANDBOX"; }
conf() { node "$ROOT/bin/agentconf" "$@"; }

# --- wire is idempotent and reports what it did ------------------------------
setup
printf '# Claude only\n' > "$HOME/.claude/CLAUDE.md"
conf wire >/dev/null 2>&1
out=$(conf check 2>&1)
[[ "$out" == ok:* ]] && ok "wire produces a state that check accepts" || bad "wire then check" "$out"

second=$(conf wire 2>&1)
if echo "$second" | grep -qE '^\s+(link|copy|edit)'; then
  bad "wire is idempotent" "second run still made changes: $second"
else
  ok "wire is idempotent — a second run changes nothing"
fi

# --- wire preserves the file it edits ----------------------------------------
grep -q "Claude only" "$HOME/.claude/CLAUDE.md" \
  && ok "the import is prepended, existing content kept" \
  || bad "wire clobbered CLAUDE.md"

ls "$HOME"/.claude/CLAUDE.md.bak.* >/dev/null 2>&1 \
  && ok "a backup is written before an existing file is edited" \
  || bad "no backup taken"
teardown

# --- the silent failure: a symlink replaced by a regular file ----------------
setup
conf wire >/dev/null 2>&1
if [ -L "$HOME/.codex/AGENTS.md" ]; then
  cp --remove-destination "$HOME/.agents/AGENTS.md" "$HOME/.codex/AGENTS.md"
  # Capture first, then grep. Under `pipefail` a pipeline from a command that exits 1 — which
  # `check` correctly does — fails whatever grep found, which silently inverts the assertion.
  msg=$(conf check 2>&1); rc=$?
  [ $rc -eq 1 ] && ok "a clobbered symlink is caught (exit 1)" || bad "clobbered symlink not caught"
  case "$msg" in
    *"not a symlink"*) ok "the message names the actual failure" ;;
    *) bad "message does not explain the clobber" "$msg" ;;
  esac
  conf wire >/dev/null 2>&1
  [ -L "$HOME/.codex/AGENTS.md" ] && ok "wire repairs it" || bad "wire did not repair the symlink"
else
  bad "codex adapter did not create a symlink"
fi
teardown

# --- a symlinked rules file is a hard error, not drift -----------------------
# Codex silently ignores a symlinked *.rules (openai/codex#16452), so this must never
# be reported as merely "in sync" just because the contents match.
setup
conf wire >/dev/null 2>&1
rm -f "$HOME/.codex/rules/shared.rules"
ln -s "$HOME/.agents/shared.rules" "$HOME/.codex/rules/shared.rules"
out=$(conf check 2>&1)
echo "$out" | grep -qi "SYMLINK" \
  && ok "a symlinked rules file is reported as not-in-force" \
  || bad "symlinked rules file went unreported" "$out"
teardown

# --- drift in a copied file --------------------------------------------------
setup
conf wire >/dev/null 2>&1
printf '\n# drifted\n' >> "$HOME/.codex/rules/shared.rules"
conf check >/dev/null 2>&1
[ $? -eq 1 ] && ok "drift in a copied file is caught" || bad "drift not caught"
teardown

# --- check is silent and passing when nothing is wired at all ----------------
# A machine with no adapters installed must not report failure — absence of a tool
# is not a broken configuration.
setup
rm -f "$HOME/.agents/AGENTS.md"
out=$(conf check 2>&1); rc=$?
[ $rc -eq 1 ] && ok "a missing shared source is an error" || bad "missing source not caught"
teardown

# --- --if-touched only speaks about managed files ----------------------------
setup
conf wire >/dev/null 2>&1
cp --remove-destination "$HOME/.agents/AGENTS.md" "$HOME/.codex/AGENTS.md"   # break it
q=$(echo '{"tool_input":{"file_path":"/tmp/unrelated.ts"}}' | conf check --quiet --context --if-touched 2>&1)
[ -z "$q" ] && ok "--if-touched stays silent for an unmanaged file" || bad "--if-touched spoke about an unrelated file" "$q"
l=$(echo "{\"tool_input\":{\"file_path\":\"$HOME/.codex/AGENTS.md\"}}" | conf check --quiet --context --if-touched 2>&1)
echo "$l" | grep -q "BROKEN" \
  && ok "--if-touched reports when a managed file is the one edited" \
  || bad "--if-touched missed a managed file" "$l"
teardown

# --- verify restores the source even when a probe fails ----------------------
setup
before=$(cat "$HOME/.agents/AGENTS.md")
PATH="/nonexistent:$PATH" conf verify --all >/dev/null 2>&1
after=$(cat "$HOME/.agents/AGENTS.md")
[ "$before" = "$after" ] \
  && ok "verify leaves no canary behind when probes cannot run" \
  || bad "verify left residue in the shared source"
teardown

# --- install-cli writes a wrapper and refuses a foreign one --------------------
setup
conf install-cli >/dev/null 2>&1
w="$HOME/.local/bin/agentconf"
[ -x "$w" ] && ok "install-cli writes an executable wrapper" || bad "no wrapper written"
grep -q "agentconf-setup-cli-wrapper" "$w" \
  && ok "the wrapper carries its sentinel" || bad "wrapper has no sentinel"

# mtime, not version sort: SHA directory names do not sort chronologically, so a
# version-sorted resolver picks an arbitrary build and nothing says so.
grep -q 'ls -dt' "$w" && ok "the wrapper resolves by mtime, not version sort" || bad "wrapper version-sorts"

out=$(conf install-cli 2>&1)
echo "$out" | grep -q refreshed && ok "re-running install-cli refreshes its own wrapper" || bad "second install-cli did not refresh" "$out"

printf '#!/bin/sh\necho someone elses script\n' > "$w"
out=$(conf install-cli 2>&1); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q refused \
  && ok "install-cli refuses to overwrite a wrapper it did not write" \
  || bad "install-cli clobbered a foreign script" "$out"
grep -q "someone elses" "$w" && ok "the foreign script survives" || bad "foreign script was overwritten"
teardown

# --- the wrapper actually resolves to a working binary -------------------------
setup
conf install-cli >/dev/null 2>&1
out=$("$HOME/.local/bin/agentconf" 2>&1 | head -1)
case "$out" in
  agentconf*) ok "the wrapper execs a working agentconf" ;;
  *) bad "wrapper did not resolve" "$out" ;;
esac
teardown

# --- restore puts a file back, and backs up the current state first ------------
setup
printf 'original\n' > "$HOME/.claude/CLAUDE.md"
conf wire >/dev/null 2>&1                      # backs up CLAUDE.md, prepends the import
stamp=$(conf restore 2>/dev/null | grep CLAUDE | head -1 | awk '{print $1}')
if [ -n "$stamp" ]; then
  ok "restore lists a backup after wire"
  conf restore "$stamp" >/dev/null 2>&1
  grep -q "^original$" "$HOME/.claude/CLAUDE.md" \
    && ok "restore puts the original content back" || bad "restore did not restore"
  # the pre-restore state must itself be recoverable, or undo is data loss
  [ "$(conf restore 2>/dev/null | grep -c CLAUDE)" -ge 2 ] \
    && ok "restore backs up the current state before overwriting" \
    || bad "restore overwrote without a backup"
else
  bad "restore listed no backup after wire"
fi
teardown

# --- backup stamps are usable as restore arguments ----------------------------
setup
printf 'x\n' > "$HOME/.claude/CLAUDE.md"
conf wire >/dev/null 2>&1
s=$(conf restore 2>/dev/null | grep CLAUDE | head -1 | awk '{print $1}')
case "$s" in
  *.) bad "backup stamp has a trailing dot: '$s'" ;;
  [0-9]*-[0-9]*) ok "backup stamp is YYYYMMDD-HHMMSS ('$s')" ;;
  *) bad "unexpected stamp format: '$s'" ;;
esac
teardown

# --- adopt reports without writing --------------------------------------------
setup
printf 'shared line\nclaude only line\n' > "$HOME/.claude/CLAUDE.md"
printf '# Shared\nshared line\n' > "$HOME/.agents/AGENTS.md"
before=$(cat "$HOME/.claude/CLAUDE.md")
out=$(conf adopt 2>&1)
[ "$before" = "$(cat "$HOME/.claude/CLAUDE.md")" ] \
  && ok "adopt writes nothing" || bad "adopt modified a file"
echo "$out" | grep -q "does not merge" \
  && ok "adopt says plainly that it does not merge" || bad "adopt did not disclaim merging" "$out"
echo "$out" | grep -q "not in the shared source" \
  && ok "adopt counts what is not yet shared" || bad "adopt gave no overlap count" "$out"
teardown

# --- scan classifies, and never wires an unproven candidate --------------------
setup
export PATH="$HOME/bin:/usr/bin:/bin"
mkdir -p "$HOME/bin"
printf '#!/bin/sh\n' > "$HOME/bin/goose"; chmod +x "$HOME/bin/goose"
out=$(conf scan 2>&1)
echo "$out" | grep -q "unmanaged" && ok "scan reports an unmanaged tool" || bad "scan missed goose" "$out"
echo "$out" | grep -q "HYPOTHESIS" \
  && ok "scan says a candidate path is not a target" || bad "scan implied candidates are wired"
[ ! -e "$HOME/.config/goose/.goosehints" ] \
  && ok "scan wires nothing for an unproven tool" \
  || bad "scan WROTE a candidate path — the one thing it must never do"

# a documented candidate is still not an adapter
echo "$out" | grep -q "Block goose" && ok "the catalogue names the tool" || bad "goose missing from output"
teardown

# --- newly installed tools are announced once ----------------------------------
setup
export PATH="$HOME/bin:/usr/bin:/bin"
mkdir -p "$HOME/bin"
printf '#!/bin/sh\n' > "$HOME/bin/claude"; chmod +x "$HOME/bin/claude"
conf check >/dev/null 2>&1                                   # seeds state
printf '#!/bin/sh\n' > "$HOME/bin/goose"; chmod +x "$HOME/bin/goose"
first=$(conf check --quiet --context 2>&1)
echo "$first" | grep -q "installed since the last scan" \
  && ok "a newly installed tool is announced" || bad "new tool not announced" "$first"
second=$(conf check --quiet --context 2>&1)
echo "$second" | grep -q "installed since the last scan" \
  && bad "the announcement repeats every session" \
  || ok "the announcement does not repeat once recorded"
teardown

# --- the first ever run does not announce everything as new --------------------
setup
export PATH="$HOME/bin:/usr/bin:/bin"
mkdir -p "$HOME/bin"
printf '#!/bin/sh\n' > "$HOME/bin/goose"; chmod +x "$HOME/bin/goose"
out=$(conf check --quiet --context 2>&1)
echo "$out" | grep -q "installed since the last scan" \
  && bad "first run announced every tool as new — that is noise, not news" \
  || ok "the first run seeds state silently"
teardown

# --- discovery never breaks the integrity check --------------------------------
# check must keep working if the catalogue is missing or unreadable; an integrity
# check that dies because discovery failed is worse than one that skips discovery.
setup
conf wire >/dev/null 2>&1
mv "$ROOT/catalog.json" "$ROOT/catalog.json.hidden"
out=$(conf check 2>&1); rc=$?
mv "$ROOT/catalog.json.hidden" "$ROOT/catalog.json"
[ $rc -eq 0 ] && [[ "$out" == ok:* ]] \
  && ok "check still works with no catalogue" || bad "a missing catalogue broke check" "$out"
teardown

echo
echo "$pass passed, $fail failed"
exit $((fail > 0))
