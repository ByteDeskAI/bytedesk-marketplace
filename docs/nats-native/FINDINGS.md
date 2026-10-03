# NATS-native coordination: findings (EP-026)

Branch `nats/integration` (plugin code) and `nats/orch-grants` in `bytedesk-remote-gateway` (grants). Contract: [CONTRACT.md](CONTRACT.md). Nothing here is pushed, merged to a shared branch or deployed.

## What was built

| Workstream | Task | Result |
|---|---|---|
| Gateway grants (`bytedesk-remote-gateway`, branch `nats/orch-grants`, `6b7af5d7`) | TM-313 | Minted creds can pull mail and use KV and objects (they could not before). Per-role narrowed grants, per-agent `_INBOX` prefix, `ORCH_EVENTS`/`ORCH_HANDOFFS`/`TM_*` layout, four TM roles, 24 h expiry, live revoke, optional leaf listener. |
| AO per-agent credentials | TM-310 | Per-agent nkey users, in-memory holder process with its own entry point, descendant-checked socket, rotate/revoke that drops the live connection, admin identity with no password on disk, schema-stamped `state.json`, short socket-path fallback, rebuilt `dist/`. |
| AO handoff, events, claims, work queue | TM-311 | Idempotent closure-contract handoff, `ORCH_EVENTS`, watch-based wait with poll fallback, fenced claims, `ORCH_TASKS` pull; grants for each added to the per-agent users. |
| TM pluggable storage | TM-312 | Backend interface, schema registry with upcasters, NATS backend with leaf mirrors, tiered reads, paged events, offline queue, `$blob` spill for large values, `tm migrate`, `tm cutover`. Default stays `file`. |
| TM-308 merged | n/a | Fixed `nats.port` wins over the sticky-port fallback. |

## Findings that changed the design

1. **Gateway creds could not work.** Grants lacked `$JS.API.*`, `$JS.ACK.*`, `$KV.*`, `$O.*`, `_INBOX.*`, and a broker-wide `$KV.>` deny would have blocked KV even after adding grants.
2. **`RevokeOrch` did not close live connections.** Fixed and tested.
3. **The 120 s dedupe window is not idempotency.** A permanent KV `create` on the handoff id closes it. Residual: a recipient that already consumed the successor (TM-315).
4. **Event reader returned another board's events** (wrong option name; stream-wide dedupe collided across boards). Fixed.
5. **Tests that passed with the feature removed** (wait-by-watch, replay idempotency): strengthened, mutation-checked.
6. **The real board broke the 20-file tests.** Five tasks are 1-3.2 MB; NATS rejects values over 1 MB (`MAX_PAYLOAD_EXCEEDED`). Schema extension, not a server limit change: fields over 256 KB spill to the object store behind a `$blob` reference.
7. **A second `tm cutover` reverted newer NATS writes.** A board already on NATS is now left alone; `migrate` reports `diverged` tasks.
8. **Committed `dist/` bundles were stale** and silently ran an older copy of the NATS code, writing password-format state and replacing the server on a new port every ~30 s. Rebuilt; `dist-fresh.test.mjs` fails on a stale bundle.
9. **A bundled `import.meta.url` names the bundle itself**, so the holder spawn would have started the CLI. The holder has its own entry.
10. **Socket paths over ~107 bytes are silently truncated by Node** and left a stray socket that caused `EADDRINUSE`.
11. **Holder spawn kept `launch` alive** via an IPC channel; closed after the handshake.
12. **Test fixture inherited the real `HOME`** and read the operator's `nats.port`; fixtures now use a temp home.
13. **Real-agent runs are contaminated by the installed plugin** (PATH, `AGENT_ORCHESTRATION_BIN`, global services). Isolation recipe in TM-331.
14. **Cross-repo mail is gated on cached lead proof**; held mail is delivered by `mailbox resume` once both leads are proven (the supervisor does this when services run).

## Verified (raw evidence kept in the worker reports and this session)

- AO unit suite on the merged tree: 1082 tests, 0 fail, 4 skipped, exit 0 (625 s). TM suite: 1648 pass, 0 fail; `run-tests.sh` exits 1 only on `test-mcp.sh` "advertises 39 tools, got 45", which fails on the base commit too. Gateway: `go vet` and `go test ./internal/bus/...` ok.
- Real `claude` agents (isolated tmux, installed plugin disabled, services off, integrated build): lead responsive, reviewer available, state `schema: 2` with no password, one server pid; a worker received a message over NATS, was rung in its real composer (`submitted`), read it with its per-agent creds and replied `PONG-FROM-CLAUDE`; `launch` exits after printing.
- Cross-repo with two real leads: held with `leads_not_ready` while the destination had no lead; after both leads were responsive and `mailbox resume` ran, both held messages were delivered and read from B's inbox.
- Cutover rehearsal on a copy of the real board (324 tasks, 27 epics, 34 ADRs, 8 plans, 65,559 events): equal on both sides in 35 s; `tm board` 1.5 s, `tm show TM-217` (2.7 MB) 0.3 s; comment persisted; second cutover wrote nothing.
- Negative tests print the server's refusal text for each grant.

## Open (filed under EP-026)

TM-315 handoff residual duplicate; TM-316 same-uid agent can rewrite server config and signal the server (threat model not fully met without a separate uid or the provider sandbox); TM-317 macOS holder peer check (Linux only); TM-318 live board cutover; TM-319 gateway merge/cutover; TM-326 TM test server leaks; TM-327 `wait` success on nothing pending; TM-328 spec-launched workers cannot ack their prompt; TM-329 flaky supervision-transport teardown; TM-330 process-compose leaks in AO fixtures; TM-331 real-agent isolation recipe.

Also open: leaf node against the production hub (tests use two local servers); a leaf never online with the hub has no copy; claim writes need the hub; the TM task-management `agents.json`, pool and dashboard files stay local by design.
