# NATS-native coordination: findings (EP-026)

Branch `nats/integration`. Contract: [CONTRACT.md](CONTRACT.md). Nothing here is merged, pushed or deployed.

## What was built

| Workstream | Task | Result |
|---|---|---|
| Gateway grants (`bytedesk-remote-gateway`, branch `nats/orch-grants`) | TM-313 | Minted creds can now pull mail, use KV and objects (they could not before). Per-role narrowed grants, per-agent `_INBOX` prefix, `ORCH_EVENTS`/`ORCH_HANDOFFS`/`TM_*` layout, four TM roles, 24 h expiry, live revoke, optional leaf listener. |
| AO per-agent credentials | TM-310 | Per-agent nkey users, in-memory holder process, descendant-checked socket, rotate/revoke that drops the live connection. |
| AO handoff, events, claims, work queue | TM-311 | Idempotent closure-contract handoff (KV create + derived `Nats-Msg-Id`), `ORCH_EVENTS`, watch-based wait with poll fallback, fenced claims, `ORCH_TASKS` pull. |
| TM pluggable storage | TM-312 | Backend interface, schema registry with upcasters, NATS backend with leaf mirrors, tiered reads, paged events, offline queue, `tm migrate`, `tm cutover`. Default stays `file`. |

## Findings that changed the design

1. **Gateway creds could not work.** Lead/worker grants lacked `$JS.API.*`, `$JS.ACK.*`, `$KV.*`, `$O.*`, `_INBOX.*`, and a broker-wide `$KV.>` deny would have blocked KV even after adding grants (deny beats allow).
2. **`RevokeOrch` did not close live connections.** Fixed and tested by disabling the close step.
3. **The 120 s dedupe window is not idempotency.** A retry after the window sent a second copy; a permanent KV `create` on the handoff id closes it. A residual window remains if the recipient already consumed the successor.
4. **Event reader returned another board's events** (wrong option name `filter_subjects`, and stream-wide `Nats-Msg-Id` dedupe collided across boards). Fixed; the test fails if reverted.
5. **A test that passes with the feature removed.** The first wait-by-watch test and the first replay-idempotency test both passed under mutation; both were strengthened.
6. **"9 baseline failures" were missing `node_modules` in worktrees**, not code. With dependencies installed, the AO unit suite is 1055 tests, 0 failures.
7. **Cross-repo mail is gated on live lead probes** (`leads_not_ready`). A hand-typed ack bypasses the gate and is labelled as such in every test.

## Verified

AO unit suite on the merged branch: 1055 tests, 0 fail, exit 0. TM suite: 1639 pass, 0 fail; `run-tests.sh` exits 1 only on `test-mcp.sh` "advertises 39 tools, got 45", which failed before this work. Gateway: `go vet` and `go test ./internal/bus/...` ok. Negative tests print the server's refusal text.

## Not verified / open

- Real `claude` leads with per-agent credentials: see "Final proof" below.
- Leaf node against the production hub (tests use two local servers).
- A leaf that was never online with the hub has no copy.
- Claim writes while offline need the hub.
- Holder peer check is Linux-only.
- TM-308 (PR #171) will conflict on version markers, changelog and `ROADMAP-SOURCES.json`.
- `tm cutover` has only been exercised on temp board copies. Cutting over the live shared board needs the plugin code merged and installed first, and a human decision on timing.
