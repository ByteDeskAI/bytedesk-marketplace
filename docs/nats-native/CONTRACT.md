# NATS integration contract (shared by all workstreams)

Operator decisions, final: NATS is the only data store (no SQLite). Every agent has its own credential, protected from sibling agents on the same OS user. Cross-server: remote-gateway is the hub, each machine is a leaf node with a local JetStream cache. Task board moves to NATS by straight cutover. Pluggable: backend interface + schema registry. Compatible: versioned envelope + upcasters.

task-management (TM) and agent-orchestration (AO) stay independent: NO imports, NO manifest dependency between them. This document is the only shared artifact; each plugin implements its side separately.

## 1. Envelope (every value in KV, every stream message body, every blob manifest)

```json
{ "type": "tm/task", "schema": 3,
  "id": "TM-123",
  "data": { "...type-specific fields, unknown fields preserved verbatim..." },
  "meta": { "actor": "ryan|agent-id", "agent": "<agent id|null>", "ts": "ISO", "src": "tm|ao|gateway|import", "rev": 7, "reason": "text", "git": { "commit": "sha|null", "pr": "N|null" } } }
```

Rules:
- `type` is `<owner>/<name>`; `schema` is an integer per type. New code reads any older schema through registered upcasters, always writes its current schema, and preserves unknown fields inside `data`.
- Additive change = same schema, optional field. Rename/retype/remove = new schema integer plus an upcaster from the old one. Never edit an old upcaster.
- Reader seeing `schema` higher than it knows: read-only passthrough. It must NOT rewrite the value (a downgrade would destroy fields). Print a clear refusal for writes.
- Plugins extend with new `type`s and new optional `data` fields via the registry; they do not fork the core types.
- Registry API (each plugin has its own copy of this shape): `register(type, { current, validate(data), upcasters: { [fromSchema]: (data) => data } })`, `decode(envelope) -> { current:boolean, data, readOnly:boolean }`, `encode(type, data, meta) -> envelope`.

### Large values

No stored message may exceed the server's `max_payload` (1 MB default); the schema, not the server limit, absorbs bigger values. A top-level `data` field whose serialized size exceeds the spill threshold (default 256 KB; config `storage.spillBytes`, env `TM_SPILL_BYTES`, `0` = off) is stored in the object store by content hash and replaced in `data` by `{"$blob": {"digest": "<sha256>", "size": <bytes>, "encoding": "json"}}`. `encoding: "json"` means the blob holds the JSON text of the original field value. Readers that know the convention fetch the blob and substitute it (a missing blob is an error, never a short value); readers that do not know it see the reference. Writers preserve an unrecognised `$blob` field as they would any unknown field. Applies to KV entities, stream events and offline proposals; blobs are cached on the leaf on first read. An additive change: schema integers do not change.

## 2. Storage backend interface (TM)

`Backend` methods (all async): `get(type,id) -> {envelope, rev}|null`, `put(type,id,envelope,{ifRev})` (CAS; throws `ConflictError` with current rev), `create(type,id,envelope)` (fails if exists), `delete(type,id,{ifRev,reason})`, `list(type,{prefix})`, `history(type,id,{limit})`, `watch(type,{since})` (async iterator of changes), `blobPut(digest|stream) -> digest`, `blobGet(digest)`, `blobList`, `appendEvent(event)`, `events({since,filter})`, `info() -> {kind, server, offline:boolean}`.
Backends: `nats` (default after cutover), `file` (current markdown store; kept as importer and test double). Selected by config `storage.backend` with env override `TM_STORAGE`. A backend that cannot do an operation says so (`UnsupportedError`), never silently no-ops.

## 3. NATS layout

Keys and subjects are prefixed by repo key `<repo>` (first 16 hex of the git-common-dir sha, as `repoKey` does today). One NATS account per repo on the hub; a leaf node on each machine.

AO (existing, keep): streams `ORCH_MAIL` (workqueue), `ORCH_TASKS`; KV `ORCH_CLAIMS` (history 16), `ORCH_PRESENCE` (ttl 45s), `ORCH_AGENTS`; object store `ORCH_REVIEWS`; core `orch.<repo>.probe.<agent>`, `orch.<repo>.review.<nonce>`.
AO (new): stream `ORCH_EVENTS` subjects `orch.<repo>.events.>` (limits retention, max_age 90d, file storage); KV `ORCH_HANDOFFS` key `<repo>.<messageId>` (idempotency + closure record); claims gain a fencing token (the KV revision) checked on every later write.
TM (new): KV `TM_ENTITIES` key `<repo>.<type>.<id>` (history 64); KV `TM_PROPOSALS` key `<repo>.<type>.<id>.<proposalId>`; KV `TM_STATE` key `<repo>.claims.<taskId>` and `<repo>.session.<sid>` (CAS replaces state.lock); stream `TM_EVENTS` subject `tm.<repo>.events.<kind>` (limits, max_age 3650d); object store `TM_EVIDENCE` names `<repo>/<sha256>`. Per-machine files (pool.state.json, dashboard.*, planner/, bin/) stay local.

## 4. Credentials and grants (gateway issues, plugins consume)

- Per-agent nkey/JWT user, one per (repo, agent), role in claims (lead, worker, reviewer, tm-cli, tm-hook, tm-dashboard, tm-pool). Finite lifetime (default 24h) with rotation; `RevokeOrch` must drop a live connection.
- Delivery: never a file or env var readable by a sibling agent on the same OS user. The launcher passes an inherited fd or a unix-socket handshake; the agent process holds the seed in memory only. Check `/proc/<pid>/environ`, `ps` and the agent dir for leaks.
- Grants must include what NATS needs to work, narrowed per agent: `$JS.API.CONSUMER.*` / `$JS.API.STREAM.INFO` limited to the agent's own durables, `$JS.ACK.<stream>.<its durable>.>`, `_INBOX.<agent-unique-prefix>.>` (set the connection `inboxPrefix`), `$KV.<bucket>.<repo>.>` limited per role, `$O.<bucket>.>` for evidence by role. A worker may publish only to other agents' `mail.<agent>` through the router rule, never subscribe to another agent's mail or reply subject. Deny: `$SYS.>`, stream create/delete/purge for non-admin roles.
- Every grant has a negative test that prints the server's refusal text.

## 5. Offline and sharing

Leaf node with local JetStream. Reads served from the local cache offline; writes become proposals queued locally and replayed on reconnect (same message id, idempotent). `tm` prints `offline: read-only, writes queued` instead of hanging. Board identity is the origin remote `owner/name`.

## 6. Idempotency and fencing

Message/handoff id is the dedupe key everywhere: JetStream `Nats-Msg-Id` (120s window) AND a KV `create` on `ORCH_HANDOFFS` (permanent). Claims: every write after claim must present the claim revision; stale revision is refused.

## 7. Verification rules (from .claude/rules/verification-that-can-fail.md)

Print raw values, not counts. Each test must fail when the behavior is absent. Record commit + dirty state beside every measurement. tmux tests: `TMUX=''`, per-test `TMUX_TMPDIR`, every kill scoped `-L`/`-S`. Run with `node --test --test-concurrency=1`. Label any result that used a hand-typed `lead ack` as "gate bypassed by hand".
