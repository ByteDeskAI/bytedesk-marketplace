#!/usr/bin/env bash
# Isolated HOME. Never touches the real plugin caches.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "       $2"; }

setup() {
  SANDBOX="$(mktemp -d)"
  export HOME="$SANDBOX"
  export BYTEDESK_MARKETPLACE="$SANDBOX/market"
  mkdir -p "$BYTEDESK_MARKETPLACE/.claude-plugin" \
    "$BYTEDESK_MARKETPLACE/alpha" \
    "$BYTEDESK_MARKETPLACE/beta" \
    "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/.claude-plugin" \
    "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/.claude-plugin" \
    "$HOME/.claude/plugins/cache/bytedesk/alpha/.claude-plugin" \
    "$HOME/.grok/installed-plugins/bd-alpha/alpha/.claude-plugin" \
    "$HOME/.codex/plugins/cache/bytedesk/alpha/c1/.claude-plugin" \
    "$HOME/.local/bin"
  printf '{}\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.grok/installed-plugins/bd-alpha/alpha/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.codex/plugins/cache/bytedesk/alpha/c1/.claude-plugin/plugin.json"
  printf '%s\n' '{"name":"bytedesk","plugins":[{"name":"alpha","source":"./alpha"},{"name":"beta","source":"./beta"}]}' \
    > "$BYTEDESK_MARKETPLACE/.claude-plugin/marketplace.json"
  printf 'source-a\n' > "$BYTEDESK_MARKETPLACE/alpha/marker.txt"
  printf 'source-b\n' > "$BYTEDESK_MARKETPLACE/beta/marker.txt"
  mkdir -p "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/node_modules"
  printf 'keep-me\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/node_modules/stay.txt"
  printf 'stale\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/gone.txt"
  printf '%s\n' '{"version":1,"repos":{"bd-alpha":{"kind":{"type":"Local","source_path":"'"$BYTEDESK_MARKETPLACE"'","subdir":"alpha"},"path":"'"$HOME"'/.grok/installed-plugins/bd-alpha","plugins":{"alpha":{"subdir":"alpha"}}}}}' \
    > "$HOME/.grok/installed-plugins/registry.json"
}

teardown() { rm -rf "$SANDBOX"; }
run() { node "$ROOT/bin/plugin-rsync" "$@"; }

echo "test-plugin-rsync"

setup
mkdir -p "$HOME/.grok/installed-plugins/bd-alpha/beta"
out=$(run --list)
echo "$out" | grep -q 'alpha' && echo "$out" | grep -q 'sha1' && ok "--list shows claude dests" || bad "--list claude" "$out"
echo "$out" | grep -q 'grok' && ok "--list shows grok dests" || bad "--list grok" "$out"
echo "$out" | grep -q 'codex' && ok "--list shows codex dests" || bad "--list codex" "$out"
echo "$out" | grep -q 'bd-alpha/beta' && bad "a grok install of alpha must not claim a sibling beta dir" "$out" || ok "grok dests stay on the declared plugin"
echo "$out" | grep -q 'cache/bytedesk/alpha/.claude-plugin' && bad "dot-dirs at the cache root are not installs" "$out" || ok "cache dot-dirs are skipped"
teardown

setup
out=$(run alpha 2>&1); code=$?
# TM-485: a sync whose Codex marketplace is not this checkout (a worktree) skips trust quietly; it used to throw.
[[ $code -eq 0 && "$out" != *TypeError* ]] && ok "a sync from a checkout Codex does not install from exits 0" || bad "foreign-trust sync" "rc=$code $out"
got=$(cat "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt")
[[ "$got" == "source-a" ]] && ok "rsync copies source into the claude cache" || bad "claude copy" "$got"
[[ ! -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/gone.txt" ]] && ok "--delete drops dest-only files" || bad "stale file survived"
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/node_modules/stay.txt" ]] && ok "node_modules is not deleted" || bad "node_modules wiped"
got=$(cat "$HOME/.grok/installed-plugins/bd-alpha/alpha/marker.txt")
[[ "$got" == "source-a" ]] && ok "rsync copies into the grok install" || bad "grok copy" "$got"
got=$(cat "$HOME/.codex/plugins/cache/bytedesk/alpha/c1/marker.txt")
[[ "$got" == "source-a" ]] && ok "rsync copies into the codex cache" || bad "codex copy" "$got"
[[ ! -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] && ok "a named plugin does not touch the others" || bad "beta was copied on alpha-only run"
teardown

setup
run alpha,beta >/dev/null
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" && -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] \
  && ok "comma-separated names rsync both" || bad "comma list"
teardown

setup
run alpha beta >/dev/null
[[ -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] && ok "space-separated names rsync both" || bad "space list"
teardown

setup
run >/dev/null
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" && -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] \
  && ok "no args rsyncs every catalog plugin that is installed" || bad "default all"
teardown

setup
out=$(run nope 2>&1); rc=$?
[[ $rc -ne 0 ]] && echo "$out" | grep -q 'not in the marketplace' && ok "unknown name is an error" || bad "unknown" "$out rc=$rc"
teardown

setup
rm -rf "$HOME/.claude/plugins/cache/bytedesk/beta" "$HOME/.codex" "$HOME/.grok"
out=$(run beta 2>&1); rc=$?
[[ $rc -ne 0 ]] && echo "$out" | grep -q 'not installed' && ok "named but uninstalled is an error" || bad "uninstalled" "$out rc=$rc"
teardown

setup
out=$(run --dry-run alpha)
echo "$out" | grep -q 'rsync' && [[ ! -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" ]] \
  && ok "--dry-run prints rsync and copies nothing" || bad "dry-run" "$out"
want="         rsync -a --delete --exclude node_modules --exclude .git --exclude .vite --exclude *.tsbuildinfo $BYTEDESK_MARKETPLACE/alpha/ $HOME/.claude/plugins/cache/bytedesk/alpha/sha1/"
echo "$out" | grep -qxF -- "$want" && ok "--dry-run prints the exact default rsync command line" || bad "default rsync argv" "$out"
teardown

setup
run install-cli >/dev/null
[[ -x "$HOME/.local/bin/plugin-rsync" ]] && grep -q plugin-rsync-setup-cli-wrapper "$HOME/.local/bin/plugin-rsync" \
  && ok "install-cli writes a user-scope wrapper" || bad "install-cli"
printf '#!/bin/sh\necho foreign\n' > "$HOME/.local/bin/plugin-rsync"
out=$(run install-cli 2>&1); rc=$?
[[ $rc -ne 0 ]] && echo "$out" | grep -q 'not overwriting' && ok "install-cli refuses a foreign wrapper" || bad "foreign wrapper" "$out rc=$rc"
teardown

# --- --json (TM-388) ---------------------------------------------------------
out=$(node "$ROOT/tests/test-classify.mjs"); rc=$?
[[ $rc -eq 0 ]] && ok "classify + parseItemized ($out)" || bad "classify" "$out"

jsq() { node "$ROOT/tests/jsq.mjs" "$1"; }

json_setup() {
  setup
  mkdir -p "$BYTEDESK_MARKETPLACE/alpha/bin" "$BYTEDESK_MARKETPLACE/alpha/hooks" "$BYTEDESK_MARKETPLACE/alpha/lib"
  printf '#!/bin/sh\n' > "$BYTEDESK_MARKETPLACE/alpha/bin/a"
  printf '#!/bin/sh\n' > "$BYTEDESK_MARKETPLACE/alpha/bin/a-mcp"
  printf 'x\n' > "$BYTEDESK_MARKETPLACE/alpha/hooks/h.sh"
  printf 'x\n' > "$BYTEDESK_MARKETPLACE/alpha/lib/x.js"
  printf '%s\n' '{"mcpServers":{"a":{"command":"${CLAUDE_PLUGIN_ROOT}/bin/a-mcp"}}}' > "$BYTEDESK_MARKETPLACE/alpha/.mcp.json"
}

json_setup
out=$(run --json --dry-run alpha); rc=$?
got=$(echo "$out" | jsq 'r.dry_run && r.plugins[0].caches.every(c => c.status === "dry-run") && r.plugins[0].caches[0].paths.length > 0')
[[ $rc -eq 0 && "$got" == true && ! -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" ]] \
  && ok "--json --dry-run previews changes without copying" || bad "json dry-run" "rc=$rc $out"
teardown

json_setup
out=$(run --json alpha); rc=$?
got=$(echo "$out" | jsq 'Object.fromEntries(r.plugins[0].caches.find(c => c.host === "claude").paths.map(p => [p.path, p.class + "/" + p.change]).sort())')
want='{".claude-plugin/plugin.json":"needs-reload/deleted",".mcp.json":"needs-reload/updated","bin/a":"live/updated","bin/a-mcp":"needs-reload/updated","gone.txt":"live/deleted","hooks/h.sh":"needs-reload/updated","lib/x.js":"needs-reload/updated","marker.txt":"live/updated"}'
[[ $rc -eq 0 && "$got" == "$want" ]] && ok "--json classifies every changed path in the claude cache" || bad "json classes rc=$rc" "$got"
got=$(echo "$out" | jsq 'r.plugins[0].caches.filter(c => c.status === "ok" && c.changed && c.path).map(c => c.host).sort().join()')
[[ "$got" == '"claude,codex,grok"' ]] && ok "--json reports each refreshed cache with path, host and changed" || bad "json caches" "$out"
got=$(echo "$out" | jsq 'r.reloads_required')
[[ "$got" == '{"claude":["alpha"],"grok":["alpha"],"codex":["alpha"]}' ]] \
  && ok "--json reloads_required names the plugin per host" || bad "reloads_required" "$got"
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/hooks/h.sh" ]] && ok "--json still copies" || bad "json did not copy"
out=$(run --json alpha)
got=$(echo "$out" | jsq 'r.plugins[0].caches.some(c => c.changed) || Object.values(r.reloads_required).some(l => l.length)')
[[ "$got" == false ]] && ok "--json second run: nothing changed, no reload" || bad "json idempotent" "$out"
printf 'y\n' > "$BYTEDESK_MARKETPLACE/alpha/bin/a"
out=$(run --json alpha)
got=$(echo "$out" | jsq 'Object.values(r.reloads_required).flat().length + ":" + r.plugins[0].caches[0].paths.map(p => p.path + "=" + p.class).join()')
[[ "$got" == '"0:bin/a=live"' ]] && ok "--json a bin/ CLI change is live and requires no reload" || bad "json live-only" "$got"
out=$(run --json beta)
got=$(echo "$out" | jsq 'r.plugins[0].caches.map(c => c.host + ":" + c.status).join()')
[[ "$got" == '"claude:ok,grok:skipped,codex:skipped"' ]] && ok "--json marks hosts without an install as skipped" || bad "json skipped" "$got"
teardown

setup
out=$(run alpha)
want="alpha
  claude ~/.claude/plugins/cache/bytedesk/alpha/sha1  ok
  codex  ~/.codex/plugins/cache/bytedesk/alpha/c1  ok
  grok   ~/.grok/installed-plugins/bd-alpha/alpha  ok"
[[ "$out" == "$want" ]] && ok "default output is unchanged by --json support" || bad "default output" "$out"
teardown

# --- fix-grok-installs (TM-396) ----------------------------------------------
setup
mkdir -p "$SANDBOX/fakebin"
printf '#!/bin/sh\necho "$*" >> "%s/grok.calls"\n' "$SANDBOX" > "$SANDBOX/fakebin/grok"; chmod +x "$SANDBOX/fakebin/grok"
out=$(PATH="$SANDBOX/fakebin:$PATH" run fix-grok-installs 2>&1)
calls=$(cat "$SANDBOX/grok.calls" 2>/dev/null)
[[ "$calls" == *"plugin uninstall alpha"* && "$calls" == *"plugin install --trust $BYTEDESK_MARKETPLACE/alpha"* && ! -d "$HOME/.grok/.plugin-rsync-fix.lock" ]] \
  && ok "fix-grok-installs reinstalls a marketplace-root Grok install from its folder" || bad "fix-grok-installs" "$out | $calls"
rm -f "$SANDBOX/grok.calls"
mkdir "$HOME/.grok/.plugin-rsync-fix.lock"; touch -d '1 hour ago' "$HOME/.grok/.plugin-rsync-fix.lock"
cat > "$SANDBOX/fakebin/grok" <<EOF
#!/bin/sh
echo "\$*" >> "$SANDBOX/grok.calls"
# The new per-folder install fails; the restore (marketplace#subdir) succeeds.
[ "\$4" = "$BYTEDESK_MARKETPLACE/alpha" ] && exit 1
exit 0
EOF
out=$(PATH="$SANDBOX/fakebin:$PATH" run fix-grok-installs 2>&1)
calls=$(cat "$SANDBOX/grok.calls" 2>/dev/null)
[[ "$calls" == *"plugin install --trust $BYTEDESK_MARKETPLACE#alpha"* && "$out" == *"restored"*"ok"* && ! -d "$HOME/.grok/.plugin-rsync-fix.lock" ]] \
  && ok "fix-grok-installs reclaims a stale lock and restores the old install when the new one fails" || bad "fix-grok-installs rollback" "$out | $calls"
rm -f "$SANDBOX/grok.calls"
printf '%s\n' '{"version":1,"repos":{"bd-alpha":{"kind":{"type":"Local","source_path":"'"$BYTEDESK_MARKETPLACE/alpha"'"},"plugins":{"alpha":{}}}}}' > "$HOME/.grok/installed-plugins/registry.json"
out=$(PATH="$SANDBOX/fakebin:$PATH" run fix-grok-installs 2>&1)
[[ ! -e "$SANDBOX/grok.calls" && "$out" == *"none needed"* ]] && ok "fix-grok-installs leaves a per-plugin install alone" || bad "fix-grok-installs no-op" "$out"
# TM-485: another local marketplace's plugins are never reinstalled, let alone with --trust.
OTHER="$SANDBOX/other-market"
mkdir -p "$OTHER/.claude-plugin" "$OTHER/gamma"
printf '%s\n' '{"name":"someone-else","plugins":[{"name":"gamma","source":"./gamma"}]}' > "$OTHER/.claude-plugin/marketplace.json"
printf '%s\n' '{"version":1,"repos":{"o-gamma":{"kind":{"type":"Local","source_path":"'"$OTHER"'"},"plugins":{"gamma":{"subdir":"gamma"}}}}}' > "$HOME/.grok/installed-plugins/registry.json"
out=$(PATH="$SANDBOX/fakebin:$PATH" run fix-grok-installs 2>&1)
[[ ! -e "$SANDBOX/grok.calls" && "$out" == *"none needed"* ]] && ok "fix-grok-installs ignores a marketplace that is not bytedesk" || bad "fix-grok-installs other marketplace" "$out | $(cat "$SANDBOX/grok.calls" 2>/dev/null)"
# TM-485: an untrusted (disabled) bytedesk entry is reported and never re-trusted.
printf '%s\n' '{"version":1,"repos":{"bd-alpha":{"kind":{"type":"Local","source_path":"'"$BYTEDESK_MARKETPLACE"'"},"plugins":{"alpha":{"subdir":"alpha"}}}}}' > "$HOME/.grok/installed-plugins/registry.json"
printf '[plugins]\nenabled = [\n    "x",\n]\ndisabled = ["user/1b36a520/alpha"]\n\n[ui]\ndisabled = ["beta"]\n' > "$HOME/.grok/config.toml"
out=$(PATH="$SANDBOX/fakebin:$PATH" run fix-grok-installs 2>&1)
[[ ! -e "$SANDBOX/grok.calls" && "$out" == *"not trusted"*"alpha"* ]] && ok "fix-grok-installs leaves an untrusted entry alone and says so" || bad "fix-grok-installs untrusted" "$out | $(cat "$SANDBOX/grok.calls" 2>/dev/null)"
rm -f "$SANDBOX/grok.calls" "$HOME/.grok/config.toml"
# TM-485: a failed uninstall is reported, and nothing is installed over the old copy.
cat > "$SANDBOX/fakebin/grok" <<EOF
#!/bin/sh
echo "\$*" >> "$SANDBOX/grok.calls"
[ "\$2" = "uninstall" ] && { echo "plugin is busy" >&2; exit 3; }
exit 0
EOF
out=$(PATH="$SANDBOX/fakebin:$PATH" run fix-grok-installs 2>&1); code=$?
calls=$(cat "$SANDBOX/grok.calls" 2>/dev/null)
[[ $code -ne 0 && "$out" == *"uninstall alpha exited 3: plugin is busy"* && "$calls" != *"install --trust"* ]] \
  && ok "fix-grok-installs reports a failed uninstall and installs nothing" || bad "fix-grok-installs failed uninstall" "$code | $out | $calls"
teardown

# --- trust-codex-hooks scope (TM-485) -----------------------------------------
# A fake `codex app-server`: answers initialize and hooks/list from $HOME/hooks.json, records every
# config write to $HOME/codex-writes.jsonl and every start to $HOME/codex-starts.
setup
mkdir -p "$SANDBOX/fakebin"
cat > "$SANDBOX/fakebin/codex" <<'FAKE'
#!/usr/bin/env node
const fs = require("fs");
const H = process.env.HOME;
fs.appendFileSync(`${H}/codex-starts`, `${process.cwd()} ${Object.keys(process.env).sort().join(",")}\n`);
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
require("readline").createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.id === 1) send({ id: 1, result: {} });
  if (m.id === 2) send({ id: 2, result: { data: [{ hooks: JSON.parse(fs.readFileSync(`${H}/hooks.json`, "utf8")) }] } });
  if (m.id === 3) { fs.appendFileSync(`${H}/codex-writes.jsonl`, JSON.stringify(m.params) + "\n"); send({ id: 3, result: {} }); }
});
FAKE
chmod +x "$SANDBOX/fakebin/codex"
printf '#!/bin/sh\necho "$*" >> "%s/grok.calls"\n' "$SANDBOX" > "$SANDBOX/fakebin/grok"; chmod +x "$SANDBOX/fakebin/grok"
CH="$SANDBOX/codex-home"   # CODEX_HOME, with no ~/.codex at all
C1="$CH/plugins/cache/bytedesk/alpha/c1"
rm -rf "$HOME/.codex"
mkdir -p "$C1/hooks" "$CH/plugins/cache/bytedesk/zeta/z1/hooks" "$BYTEDESK_MARKETPLACE/alpha/hooks" "$SANDBOX/evil/hooks"
for d in "$C1" "$BYTEDESK_MARKETPLACE/alpha"; do
  printf '{"hooks":{}}\n' > "$d/hooks/hooks.json"; printf 'echo h\n' > "$d/hooks/h.sh"
done
printf 'echo source\n' > "$BYTEDESK_MARKETPLACE/alpha/hooks/other.sh"; printf 'echo source\n' > "$C1/hooks/other.sh"
printf '[marketplaces.bytedesk]\nsource_type = "local"\nsource = "%s"\n' "$BYTEDESK_MARKETPLACE" > "$CH/config.toml"
hook() { # key pluginId source sourcePath trustStatus command
  jq -nc --arg k "$1" --arg p "$2" --arg s "$3" --arg sp "$4" --arg t "$5" --arg c "$6" \
    '{key:$k,pluginId:$p,source:$s,sourcePath:$sp,trustStatus:$t,command:$c,currentHash:("sha256:"+$k)}'
}
{
  hook good alpha@bytedesk plugin "$C1/hooks/hooks.json" untrusted "bash \"$C1/hooks/h.sh\""
  hook modified-same alpha@bytedesk plugin "$C1/hooks/hooks.json" modified "bash \"$C1/hooks/h.sh\" Stop"
  hook already alpha@bytedesk plugin "$C1/hooks/hooks.json" trusted "bash \"$C1/hooks/h.sh\""
  hook outside-source alpha@bytedesk plugin "$SANDBOX/evil/hooks/hooks.json" untrusted "bash \"$SANDBOX/evil/h.sh\""
  hook outside-command alpha@bytedesk plugin "$C1/hooks/hooks.json" untrusted "bash \"$SANDBOX/evil/h.sh\""
  hook shell-syntax alpha@bytedesk plugin "$C1/hooks/hooks.json" untrusted "bash \"$C1/hooks/h.sh\"; curl evil"
  hook relative alpha@bytedesk plugin "$C1/hooks/hooks.json" untrusted "bash ../../../../evil/h.sh"
  hook user-source alpha@bytedesk user "$C1/hooks/hooks.json" untrusted "bash \"$C1/hooks/h.sh\""
  hook not-in-catalog zeta@bytedesk plugin "$CH/plugins/cache/bytedesk/zeta/z1/hooks/hooks.json" untrusted "bash \"$CH/plugins/cache/bytedesk/zeta/z1/hooks/h.sh\""
  hook other-market alpha@other plugin "$C1/hooks/hooks.json" untrusted "bash \"$C1/hooks/h.sh\""
} | jq -s . > "$HOME/hooks.json"
tc() { CODEX_HOME="$CH" PATH="$SANDBOX/fakebin:$PATH" run trust-codex-hooks 2>&1; }
out=$(tc)
got=$(jq -r '.edits[0].value | keys | join(",")' "$HOME/codex-writes.jsonl" 2>/dev/null)
[[ "$got" == "good,modified-same" ]] && ok "trust-codex-hooks trusts only this marketplace's own cached hooks, and a modified one only when it matches source" \
  || bad "trust-codex-hooks scope" "trusted=[$got] | $out"
[[ "$out" == *"codex hooks trusted: good, modified-same"* && ! -e "$CH/.plugin-rsync-trust.lock" && ! -e "$HOME/.codex" ]] && ok "trust-codex-hooks keeps its lock under CODEX_HOME and releases it" || bad "CODEX_HOME lock" "$(ls -a "$CH" "$HOME")"
starts=$(cat "$HOME/codex-starts")
[[ "$starts" == "$ROOT "* && "$starts" != *SANDBOX_SECRET* ]] && ok "codex app-server runs from the plugin root with a reduced env" || bad "codex spawn cwd/env" "$starts"
rm -f "$HOME/codex-writes.jsonl" "$HOME/codex-starts"
# A modified hook is trusted only when its whole cached plugin root matches source: a file its
# script could source differs, or the cache holds a file the source lacks.
cp "$HOME/hooks.json" "$HOME/hooks.all.json"
hook modified-same alpha@bytedesk plugin "$C1/hooks/hooks.json" modified "bash \"$C1/hooks/h.sh\" Stop" | jq -s . > "$HOME/hooks.json"
printf 'echo tampered\n' > "$C1/hooks/other.sh"
out=$(tc)
[[ ! -e "$HOME/codex-writes.jsonl" ]] && ok "a modified hook is not trusted when another file in its plugin root differs from source" || bad "modified sibling tamper" "$out | $(cat "$HOME/codex-writes.jsonl")"
printf 'echo source\n' > "$C1/hooks/other.sh"; printf 'extra\n' > "$C1/hooks/planted.sh"
out=$(tc)
[[ ! -e "$HOME/codex-writes.jsonl" ]] && ok "a modified hook is not trusted when its plugin root holds a file source lacks" || bad "modified planted file" "$out | $(cat "$HOME/codex-writes.jsonl")"
rm -f "$C1/hooks/planted.sh"
out=$(tc)
[[ "$(jq -r '.edits[0].value | keys | join(",")' "$HOME/codex-writes.jsonl" 2>/dev/null)" == "modified-same" ]] && ok "the same modified hook is trusted once the tree matches again" || bad "modified control" "$out"
mv "$HOME/hooks.all.json" "$HOME/hooks.json"
rm -f "$HOME/codex-writes.jsonl" "$HOME/codex-starts"
SANDBOX_SECRET=1 tc >/dev/null
[[ -s "$HOME/codex-starts" && "$(cat "$HOME/codex-starts")" != *SANDBOX_SECRET* ]] && ok "a session variable does not reach codex" || bad "reduced env" "$(cat "$HOME/codex-starts" 2>/dev/null)"
rm -f "$HOME/codex-writes.jsonl" "$HOME/codex-starts"
# A fresh lock is another run: nothing is spawned. A stale one is reclaimed.
mkdir "$CH/.plugin-rsync-trust.lock"
out=$(tc)
[[ "$out" == *"another run"* && ! -e "$HOME/codex-starts" ]] && ok "trust-codex-hooks stands down while another run holds the lock" || bad "busy lock" "$out"
touch -d '1 hour ago' "$CH/.plugin-rsync-trust.lock"
out=$(tc)
[[ -e "$HOME/codex-starts" && ! -e "$CH/.plugin-rsync-trust.lock" && -z "$(ls "$CH" | grep stale)" ]] && ok "trust-codex-hooks reclaims a stale lock and leaves nothing behind" || bad "stale lock" "$out | $(ls -a "$CH")"
rm -f "$HOME/codex-writes.jsonl" "$HOME/codex-starts"
# A run's release removes only the lock it made: if another run has replaced it, that lock stays.
lockres=$(PR_BIN="$ROOT/bin/plugin-rsync" PR_DIR="$SANDBOX" node --input-type=module -e '
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { acquireLock } = await import(pathToFileURL(process.env.PR_BIN).href);
const L = process.env.PR_DIR + "/t.lock";
const release = acquireLock(L, 60000);
rmSync(L, { recursive: true }); mkdirSync(L);
release();
const kept = existsSync(L);
const busy = acquireLock(L, 60000) === null;
rmSync(L, { recursive: true });
console.log(`${kept} ${busy}`);
' 2>&1)
[[ "$lockres" == "true true" ]] && ok "a lock release never removes another run's lock" || bad "lock ownership" "$lockres"
# Codex's bytedesk marketplace registered somewhere else: nothing is trusted, codex is not started.
printf '[marketplaces.bytedesk]\nsource_type = "local"\nsource = "%s"\n' "$SANDBOX/evil" > "$CH/config.toml"
out=$(tc)
[[ "$out" == *"not this marketplace"* && ! -e "$HOME/codex-starts" ]] && ok "trust-codex-hooks refuses a bytedesk marketplace registered elsewhere" || bad "foreign marketplace" "$out"
printf '[marketplaces.bytedesk]\nsource_type = "local"\nsource = "%s"\n' "$BYTEDESK_MARKETPLACE" > "$CH/config.toml"
# The MCP server answers at once, starts only the trust run, and never repairs Grok.
rm -f "$SANDBOX/grok.calls"
resp=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | CODEX_HOME="$CH" PATH="$SANDBOX/fakebin:$PATH" timeout 5 node "$ROOT/bin/plugin-rsync-mcp"); code=$?
for _ in $(seq 50); do [[ -e "$HOME/codex-writes.jsonl" ]] && break; sleep 0.1; done
[[ $code -eq 0 && "$(echo "$resp" | jq -sc 'map(.id)')" == "[1,2]" && "$(echo "$resp" | jq -sc '.[1].result.tools')" == "[]" ]] \
  && ok "plugin-rsync-mcp answers initialize and tools/list without waiting for the trust run" || bad "mcp answers" "$code | $resp"
[[ -e "$HOME/codex-writes.jsonl" && ! -e "$SANDBOX/grok.calls" ]] && ok "plugin-rsync-mcp runs trust-codex-hooks and not fix-grok-installs" || bad "mcp spawns" "$(ls "$HOME") | $(cat "$SANDBOX/grok.calls" 2>/dev/null)"
teardown

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
