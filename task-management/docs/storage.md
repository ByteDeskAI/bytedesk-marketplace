# Storage: backends, schemas, and extending task-management

Task-management stores its board through a `Backend` (`lib/storage/backend.mjs`). Two exist:

| Backend | Select with | State |
|---|---|---|
| `file` (default) | nothing, or `storage.backend: "file"` | The markdown store, unchanged. |
| `nats` | `TM_STORAGE=nats` or `tm config storage.backend nats` | KV `TM_ENTITIES`, `TM_PROPOSALS`, `TM_STATE`; stream `TM_EVENTS`; object store `TM_EVIDENCE`. |

`nats` is opt-in until the cutover is approved. It needs `npm install` in this plugin (the `nats`
package) and `TM_NATS_URL` (plus `TM_NATS_CREDS`, a creds file). The ambient `NATS_URL` is never read.

## Offline

If the server cannot be reached, `tm` prints `offline: read-only, writes queued`, serves reads from a
local cache (`~/.cache/task-management/<repo>/`, override `TM_CACHE_DIR`), and queues writes as
proposals. On the next successful connection they replay under their original proposal id, against
the revision the writer last saw: a change made elsewhere meanwhile is recorded as a `conflict`
proposal in `TM_PROPOSALS` instead of being overwritten. Claims and the write lease need a live
server and are refused offline.

## Migrating a board

    tm migrate --dry-run      # counts only; writes nothing
    tm migrate                # one `tm export` snapshot, copy, then re-read and compare both sides

Safe to re-run. Exit code 1 if any type's count or content differs.

## Schemas

Every stored value is an envelope `{type, schema, id, data, meta}`. Core types are `tm/task`,
`tm/epic`, `tm/adr`, `tm/sprint`, `tm/capability`, `tm/plan`, `tm/evidence`, all at schema 1;
the legacy markdown frontmatter shape is schema 0 and is lifted by an upcaster.

- Add an optional field: no schema change. Unknown fields are preserved on every rewrite.
- Rename, retype or remove a field: bump `current`, add `upcasters[old]`. Never edit an old upcaster.
- A value at a higher schema than this version knows is read-only; a write over it is refused.

## Adding a type or field from another plugin

No core edit. Import the registry and register at load time:

    import { register } from "<path to task-management>/lib/storage/registry.mjs";
    register("acme/widget", {
      current: 1,
      validate: (data) => { if (!data.id) throw new Error("id required"); },
      upcasters: { 0: (d) => ({ ...d, size: d.size ?? "m" }) },   // always spread: keep unknown fields
    });

Then use any backend: `backend.put("acme/widget", id, encode("acme/widget", data))`. Adding an
optional field to a core type is done the same way by the owner of that type, without a bump.

## Leaf node

Point `TM_NATS_URL` at the machine's leaf node and set `TM_NATS_DOMAIN` to the hub's JetStream
domain. Writes go to the hub through the leaf. On first contact the backend also creates, in the
leaf's own JetStream, mirrors of `TM_ENTITIES`, `TM_PROPOSALS`, `TM_STATE` (KV) and `TM_EVENTS`
(stream), and a local object store `TM_EVIDENCE` that `blobGet` fills on demand.

Reads are served by the first tier that answers; `info()` reports `tier` and `lastReadTier`:

| tier | when | what it is |
|---|---|---|
| `hub` | hub reachable | authoritative, read-your-writes |
| `leaf` | hub down, leaf up | the leaf's JetStream mirror (revisions match the hub's; may lag by the mirror's catch-up) |
| `cache` | leaf unreachable too | local files under `~/.cache/task-management/<repo>/`, last resort |

Writes while the hub is down are queued as proposals on this machine and replayed on reconnect
under their original proposal id (see Offline). A leaf that has never been online with the hub has
no copy yet; it falls through to `cache`.

## Events are paged

`events()`/`eventsPage()` never fetch the stream in one go: at most 500 rows per server fetch,
`limit` and a stream-sequence cursor (`after` → `next`). `readEvents(p, {limit, after})` pages the
same way. `tm doctor` shows the event count from stream metadata and fetches no messages.

## Credentials

`TM_NATS_CREDS` is a standard `.creds` file (user JWT + seed). A server that answers
"Authorization Violation" — wrong operator, expired, or no credential — is **not** treated as
offline: the command fails with "nats refused the credentials", and nothing is queued against a
credential that cannot work. The server answers "Authorization Violation" to everything, so the
client decodes the creds file first: an expired one fails before connecting with
`credentials expired at <time>`; one that is valid but not accepted says it is not expired, so the
cause is the wrong operator/account or a revoked user.

## Cutting a board over

    tm cutover --dry-run      # plan only: nothing is written, config.json untouched
    tm cutover                # snapshot, migrate, compare both sides, then set storage.backend=nats

`tm cutover` refuses, and leaves `storage.backend` alone, unless every type, the evidence blobs and
the event history compare equal. It never changes the default for boards that do not run it.
Plans migrate as `tm/plan` entities; the event history migrates once — each event gets a stable
id (a hash of the row), a re-run publishes only events the stream does not have yet.

## Large values

NATS refuses a message over `max_payload` (1 MB by default) with `MAX_PAYLOAD_EXCEEDED`. Real task
bodies hold evidence and notes and reach several MB, so the schema carries them instead of the server
limit being raised. A top-level `data` field whose JSON is larger than the threshold is stored in the
`TM_EVIDENCE` object store, named by content hash, and replaced in the envelope by a reference:

    "body": { "$blob": { "digest": "<sha256 of the stored bytes>", "size": 3465793, "encoding": "json" } }

- **Threshold:** 256 KB. Set `storage.spillBytes` in config (`tm config storage.spillBytes 131072`) or
  `TM_SPILL_BYTES` (env wins). `0` turns spilling off; a larger value then fails at the server's limit.
  An envelope still over ~900 KB after that has its largest fields spilled until it fits.
- **Applies to** entities (`put`/`create`), events (the event id is hashed from the full row first, so
  re-runs still dedupe) and queued offline proposals (the blob is written to the local cache and
  uploaded on replay).
- **Reading:** `get`, `list`, `history`, `watch` and `events` return the field whole. A blob that
  cannot be fetched is an error, never a shortened value. `registry.decodeAsync(envelope, fetchBlob)`
  does the same for code that reads a raw envelope; the synchronous `decode` leaves the reference
  untouched.
- **Old readers** that do not know `$blob` see the reference object, not a truncated string.
- **Leaf node:** the KV mirrors carry the small envelope. A read through the hub also caches the blob
  in the leaf's object store, so the leaf serves the entity whole with the hub down.
- **Same bytes, one blob:** an unchanged field is not uploaded again; old blobs are kept (history
  revisions still point at them).
- **Re-running a migration:** an entity that `tm` has written in NATS since the import is never
  overwritten from the (older) markdown copy; `tm migrate` reports it as `diverged`. `tm cutover` on a
  board already on `nats` does nothing.

Limits met rehearsing a 324-task, 65,559-event board: only `max_payload`. The migration published all
events in about 30 s with the default `TM_EVENTS` stream (no `max_msgs`, `max_bytes` or per-subject
limit) and the default KV history of 64.

## Board key and its alias

The board key is `sha256(origin owner/name)[:16]`, so every clone shares one board. Earlier work used
`sha256(<repo>/.git)[:16]`, the path-based key. On connect the backend uses the primary key if it holds
any entities, otherwise the first alias that does; writes then go to the same key, so a board created
under the old key keeps resolving and is never split across two keys. There is no automatic
re-keying; move data between keys deliberately with `tm migrate` if you ever want to.

## What stays on disk, on purpose

With the NATS backend, `store.mjs` routes entities, ids, the write lease, claims and events, and
`readEvents` reads the shared stream (the local `events.jsonl` is still written, for the dashboard
tail). Evidence and plans live in NATS (blobs, `tm/plan`); the files under `evidence/` and `plans/`
are a working copy that is restored from the backend when missing. `doctor` reports the backend and
server, and skips the checks that only make sense for files (duplicate ids, stray temp files,
`index.json` drift).

Per-machine and unchanged: `agents.json` (this machine's worker registry), `pool.state.json`,
`pool.pid`/`pool.log`, `dashboard.*`, `planner/`, `state.json` (overrides, last stop block), and the
user-supplied goal documents that `goal-import` and the dashboard read from disk.
