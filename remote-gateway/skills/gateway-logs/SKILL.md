---
name: gateway-logs
description: >
  Diagnose problems from a ByteDesk remote gateway's own log index with the
  gateway `logs` plugin: find the right logger, query by time window, level,
  text or correlation id, tail live, line logs up with an incident, export an
  NDJSON evidence slice, and mute a noisy logger reversibly. Use this whenever
  something on a gateway host misbehaves — errors, 5xx, a plugin that will not
  start, a crash or restart loop, slow requests, an agent session that died,
  "what happened at 03:27", "check the gateway logs", "tail the logs", "why is
  the log store full", "this logger is spamming" — and before guessing at a
  cause, even when the user does not say "logs". Covers the MCP tools
  `logs_list_loggers`, `logs_query`, `logs_get`, `logs_stats`,
  `logs_get_storage`, `logs_set_storage`, `logs_export`, `logs_mute_logger`,
  `logs_unmute_logger`, `logs_flush_now`, and the HTTP API `/logs/api/*`.
  For CPU, memory or goroutine questions use gateway-profiling next.
allowed-tools:
  - Bash
  - Read
---

# Gateway logs

The gateway keeps its own searchable log index: an in-memory ring plus SQLite
segments, one **logger** per plugin or host subsystem (`kernel`, `access`,
`terminal-runtime`, …). It is faster and better filtered than `journalctl`.
Read it before you form a theory, and quote the records you used as evidence.

Never print, log or paste a token, cookie value or password. Log records can
contain secrets the redactor missed; when you copy evidence, drop or mask any
value that looks like a credential.

## 1. Reach the tools

Use the first route that works.

**A. MCP tools.** If `logs_stats` is in your tool list (often as
`mcp__bytedesk-gateway__logs_stats`), call the tools directly. They come from
the running gateway's MCP endpoint (`http://127.0.0.1:8757/mcp`), which only
accepts an *operator* API token as a Bearer. The stand-alone stdio
`mcp-gateway` subcommand in the per-session generated config does not carry
the plugin tools, so do not expect `logs_*` there.

**B. HTTP API.** Otherwise log in with the `remote-gateway-login` skill and
reuse its cookie jar. It reads `~/.bytedesk/remote-gateway/agent-login.yaml`
and prints JSON with `url` and `cookieJar`; it never prints the password.

```bash
LOGIN="${CLAUDE_PLUGIN_ROOT:-<remote-gateway plugin dir>}/skills/remote-gateway-login/scripts/login.sh"
OUT=$(bash "$LOGIN") || { echo "$OUT"; exit 1; }   # stop on exit 2-5; see remote-gateway-login
U=$(jq -r .url <<<"$OUT"); J=$(jq -r .cookieJar <<<"$OUT")
gw() { curl -sS -m 30 -b "$J" "$U$@"; }      # gw /logs/api/stats
```

For another host, pass that gateway's `--url --method --username --password`
to the login script, or use the infrastructure repo's `infra run <service> --`
when the registry has an entry for it. A 401 means log in again; do not build
your own login request.

| MCP tool | HTTP equivalent |
|---|---|
| `logs_stats` | `GET /logs/api/stats` |
| `logs_list_loggers` | `GET /logs/api/loggers` |
| `logs_query` | `GET /logs/api/query?…` |
| `logs_get` (correlation id) | `GET /logs/api/query?correlation_id=…` |
| (tail, HTTP only) | `GET /logs/api/tail?…` (server-sent events) |
| `logs_export` | `GET /logs/api/export?…` (NDJSON) |
| `logs_get_storage` / `logs_set_storage` | `GET` / `PUT /logs/api/storage` |
| `logs_mute_logger` / `logs_unmute_logger` | `POST /logs/api/mute` `{"logger":"x","muted":true\|false}` |
| `logs_flush_now` | `POST /logs/api/flush` |

Filter parameters (MCP arguments, or HTTP query string):
`logger`, `tree` (`exact` | `deps` = plus what it requires | `callers` = plus
plugins that depend on it), `levels` (HTTP: `level=ERROR,WARN`), `text`
(case-insensitive substring), `correlation_id`, `since` / `until` (RFC3339 or
unix ms), `limit` (default 50, maximum 500). Check timestamps rather than
assuming the order of returned records.

## 2. Diagnose

1. **Confirm the store is healthy.** `logs_stats`. If `ingestEnabled` is false
   or the ring is dropping records, say so: missing logs are a finding, not
   proof that nothing happened.
2. **Find the logger.** `logs_list_loggers` shows counts, suppressed counts,
   last activity and muted state. A logger whose `last` time stops at the
   incident points at the component that stopped. A high `suppressed` count
   means rate limiting hid lines.
3. **Narrow the window.** Start from the incident time (from the user, a
   process-evaluator finding, a systemd restart or an alert) and query a few
   minutes either side: `levels=["ERROR","WARN"]`, then widen to `INFO` around
   the first error.
4. **Follow the dependency chain.** If the failing plugin's own logs are
   clean, repeat with `tree=deps` (something it needs failed) or
   `tree=callers` (who was calling it).
5. **Follow one request.** Take a `correlation_id` from an error record and
   fetch every record with it (`logs_get`). That is the cross-plugin story of
   one request.
6. **Tail while reproducing.** HTTP only:
   `curl -sS -N -m 60 -b "$J" "$U/logs/api/tail?logger=kernel&level=ERROR,WARN"`.
   The stream closes after about 55 seconds idle; reconnect with `since=` set
   to the last record's time.
7. **Recent lines missing?** `logs_flush_now` drains the ring to disk. It is
   safe and changes no settings.

Say what the logs show, the first bad record, and what it implies. Then go to
gateway-profiling for CPU, memory, lock or goroutine symptoms, or to the fix.

## 3. Capture evidence

Export the slice you relied on, not the whole store:

```bash
mkdir -p "$EVIDENCE_DIR"
gw "/logs/api/export?logger=kernel&level=ERROR,WARN&since=2026-10-05T03:20:00-04:00&until=2026-10-05T03:40:00-04:00" \
  > "$EVIDENCE_DIR/gateway-logs-kernel.ndjson"
```

`EVIDENCE_DIR` is the task's evidence folder, the incident runbook entry or the
playbook the caller named. Record the exact filter beside the file so another
agent can re-run it. Mask credential-looking values before attaching it.

## 4. Change things only with care

- **Mute a noisy logger** (reversible write). Read `logs_list_loggers` first
  and name the logger exactly. Muting drops that logger's lines at ingest, so
  you lose its evidence until you unmute; the drop count stays in stats.
  Confirm with the requester on a production host, record why, then
  `logs_mute_logger {"logger":"x"}`. Undo with `logs_unmute_logger`. Prefer
  fixing the noise at its source and unmute once that ships.
- **Storage policy** (`logs_set_storage`, `PUT /logs/api/storage`). Read
  `logs_get_storage` first and keep the old JSON as the rollback. Lowering
  retention or size caps deletes history permanently — that is destructive;
  get explicit confirmation. Changes apply on the next flush, with no restart.
- Verify every change with a read (`logs_stats`, `logs_list_loggers`) and
  report what you observed.
