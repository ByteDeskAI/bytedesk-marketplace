#!/usr/bin/env bash
# TM-317: run ON A MAC to check the credential holder's caller check. Prints PASS/FAIL per check.
# Uses a private temp dir; never touches ~/.bytedesk/agent-orchestration/nats or a live nats-server.
set -u
cd "$(dirname "$0")/.." || exit 2
fail=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }
[ "$(uname -s)" = Darwin ] || { echo "FAIL  not macOS ($(uname -s)); this script verifies the darwin path"; exit 2; }
for t in lsof ps node; do command -v "$t" >/dev/null && ok "$t present" || bad "$t present"; done
export AO_NATS_HOME="$(mktemp -d)" TMUX='' AGENT_ORCHESTRATION_SERVICES=0
unset NATS_URL AO_NATS_URL
trap 'rm -rf "$AO_NATS_HOME"' EXIT
node --test tests/unit/peer-process.test.mjs >/dev/null 2>&1 && ok "unit tests (parsers, fail-closed)" || bad "unit tests"
# Real lsof on a real socket: the holder-side peerPids must name the connecting child, and the child's parent must be us.
node --input-type=module -e '
import net from "node:net"; import { spawn } from "node:child_process"; import { join } from "node:path";
import { peerPids, parentOf, isAlive } from "./topology/lib/peer-process.mjs";
const sock = join(process.env.AO_NATS_HOME, "s.sock");
const child = spawn(process.execPath, ["-e", `require("net").connect(${JSON.stringify(sock)});setTimeout(()=>{},15000)`], { stdio: "ignore" });
const server = net.createServer(async (s) => {
  const peers = peerPids(s, sock);
  const out = { peer: peers.includes(child.pid), parent: parentOf(child.pid) === process.pid, alive: isAlive(child.pid), dead: !isAlive(2147483646) };
  console.log(JSON.stringify(out)); child.kill(); server.close(); process.exit(0);
});
server.listen(sock);
' > "$AO_NATS_HOME/out.json" 2>"$AO_NATS_HOME/err.txt"
for k in peer parent alive dead; do
  grep -q "\"$k\":true" "$AO_NATS_HOME/out.json" && ok "real lsof/ps: $k" || bad "real lsof/ps: $k (see: lsof -nP -U -F pfdtn | head)"
done
[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED — paste this output into TM-317"
exit "$fail"
