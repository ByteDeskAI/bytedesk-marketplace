#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export KM_ROOT="$TMP"
export KM_NO_AUTOLINK=1

node "$ROOT/bin/km" init
node "$ROOT/bin/km" concept new "MCP Concept" --type API --dir apis --desc "mcp fixture"

# Drive MCP handleRequest via node one-shot (same shipped module as km-mcp)
cd "$ROOT"
node --input-type=module <<'EOF'
import { handleRequest, callTool } from "./lib/mcp.mjs";
import { paths } from "./lib/paths.mjs";
const p = paths();
const init = handleRequest({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }, p);
if (!init.result?.serverInfo?.version) throw new Error("no server version");
const search = callTool("km_search", { query: "MCP" }, p);
if (!search.ok || !search.hits?.length) throw new Error("search failed: " + JSON.stringify(search));
const show = callTool("km_show", { id: search.hits[0].id }, p);
if (!show.ok) throw new Error("show failed");
const val = callTool("km_validate", {}, p);
if (!val.ok) throw new Error("validate failed: " + JSON.stringify(val));
console.log("mcp tools ok", search.hits[0].id, show.title);
EOF

echo "test-mcp.sh OK"
