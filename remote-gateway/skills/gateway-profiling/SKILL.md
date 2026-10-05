---
name: gateway-profiling
description: >
  Find where a ByteDesk remote gateway spends CPU, memory, goroutines or lock
  time with the gateway `profiling` plugin: list and switch per-plugin
  profiling, capture a CPU profile or a heap, allocs, goroutine, mutex or
  block snapshot, summarize hot functions and the suspected culprit plugin,
  read the flame graph, compare before and after a fix, and switch profiling
  off afterwards. Use this whenever the gateway or one of its plugins is slow,
  pegs a CPU, grows in memory, leaks goroutines, hangs, stalls on a lock, or
  process-evaluator or host-monitor flags the gateway process — "profile the
  gateway", "why is bytedesk-emote-gateway at 100% CPU", "is the terminal
  plugin leaking", "did my fix help" — even when the user does not say
  "profile". Covers the MCP tools `profiling_list`, `profiling_set`,
  `profiling_capture_cpu`, `profiling_capture_snapshot`, `profiling_captures`,
  `profiling_get_meta`, `profiling_summarize`, `profiling_compare`, and the
  HTTP API `/profiling/api/*`. Read gateway-logs first when the symptom is an
  error rather than resource use.
allowed-tools:
  - Bash
  - Read
---

# Gateway profiling

The gateway can profile itself per plugin. In-process plugins are separated by
pprof labels; a spawned plugin (`external: true`) profiles its own process.
Captures are stored on the host, so you can summarize and compare them later.

Never print, log or paste a token, cookie value or password.

## 1. Reach the tools

**A. MCP tools.** If `profiling_list` is in your tool list (often as
`mcp__bytedesk-gateway__profiling_list`), call the tools directly. They are
served by the running gateway at `http://127.0.0.1:8757/mcp`, which accepts
only an *operator* API token as a Bearer. The stand-alone stdio
`mcp-gateway` in the per-session generated config does not carry them.

**B. HTTP API.** Otherwise log in with the `remote-gateway-login` skill and
reuse the cookie jar (it prints `url` and `cookieJar`, never the password):

```bash
LOGIN="${CLAUDE_PLUGIN_ROOT:-<remote-gateway plugin dir>}/skills/remote-gateway-login/scripts/login.sh"
OUT=$(bash "$LOGIN") || { echo "$OUT"; exit 1; }   # stop on exit 2-5; see remote-gateway-login
U=$(jq -r .url <<<"$OUT"); J=$(jq -r .cookieJar <<<"$OUT")
gw() { curl -sS -m 90 -b "$J" "$U$@"; }
```

For another host, give the login script that gateway's flags, or use
`infra run <service> --` from the infrastructure repo. Do not use
`gateway_api` for this: it refuses profiling paths.

| MCP tool | HTTP equivalent |
|---|---|
| `profiling_list` | `GET /profiling/api/plugins` |
| `profiling_set {id, enabled, levels?, all?, callers?}` | `POST /profiling/api/switch` (same JSON) |
| `profiling_capture_cpu {plugin?, seconds?}` | `POST /profiling/api/capture {"kind":"cpu","plugin":"x","seconds":20}` |
| `profiling_capture_snapshot {kind, seconds?}` | `POST /profiling/api/capture {"kind":"heap"}` |
| `profiling_captures {kind?, plugin?, limit?}` | `GET /profiling/api/captures?kind=&plugin=&limit=` |
| `profiling_get_meta {id}` | `GET /profiling/api/captures/{id}` |
| `profiling_summarize {id, top?}` | `GET /profiling/api/captures/{id}/summary?top=15` |
| (flame graph) | `GET /profiling/api/captures/{id}/flame` |
| (raw pprof) | `GET /profiling/api/captures/{id}/download` |
| `profiling_compare {a, b, top?}` | none; fetch both summaries and diff the flat shares |

## 2. Pick the capture for the symptom

| Symptom | Capture |
|---|---|
| High CPU, slow responses | CPU, 10–30 s, while the problem is happening |
| Memory growing (RSS, process-evaluator leak finding) | `heap` now and again later; `allocs` for churn |
| Goroutine count climbing, hangs, leaked sessions | `goroutine` |
| Requests stall but CPU is low | `mutex` and `block` (these sample over `seconds`) |

## 3. Diagnose

1. **Inventory.** `profiling_list`. Note each plugin's `enabled`, `external`
   and `eligible` (with `reason`, such as "spawned plugin is not running").
   Write down which plugins were already on, so you can restore that state.
2. **Switch on only what you need.** A CPU capture of one plugin needs that
   plugin switched on: `profiling_set {"id":"x","enabled":true}`. Add
   `levels: N` or `all: true` to include what it depends on, or
   `callers: true` to include what depends on it. Profiling adds overhead, so
   on a production host say what you are switching on and for how long.
   Snapshots (`heap`, `goroutine`, …) cover the whole gateway process and do
   not need a switch.
3. **Capture while the symptom is live.** An idle CPU profile proves nothing.
   Reproduce, or capture during the slow period. Empty `plugin` profiles the
   whole gateway process.
4. **Summarize.** `profiling_summarize {"id":N,"top":20}` gives the top
   functions by flat cost, cumulative share, and a suggested culprit plugin
   when one plugin's frames dominate. Open `/flame` when you need the call
   path. Use `/download` with `go tool pprof` only for deeper work.
5. **Explain.** Name the hot function, its share, the owning plugin, and how
   it matches the symptom and the log evidence from gateway-logs.

## 4. Verify a fix

Take a "before" capture of the same kind, plugin and duration. Apply the fix
(through the normal release and cutover path, never a hand-copied binary).
Take an "after" capture under the same load, then
`profiling_compare {"a":before,"b":after}`. A fix counts only if the hot
function's flat share fell and the symptom is gone. Report both ids and the
deltas.

## 5. Clean up — always

- Switch off everything you switched on:
  `profiling_set {"id":"x","enabled":false}` with the same `levels`, `all` or
  `callers` you used. Off is always allowed. Leave plugins that were already
  on before you started as they were.
- Confirm with `profiling_list` and report the final state.
- Keep the captures you cite. Deleting a capture
  (`DELETE /profiling/api/captures/{id}`) destroys evidence; do it only when
  asked.

## 6. Capture evidence

Save the summaries you relied on into the task's evidence folder, the
incident runbook entry or the playbook the caller named:

```bash
gw "/profiling/api/captures/$ID/summary?top=20" > "$EVIDENCE_DIR/profile-$ID-summary.json"
```

Record the capture ids, kind, plugin, duration and what load was running.
