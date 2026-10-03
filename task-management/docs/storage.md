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

## Not routed through the backend yet

`store.mjs` routes entity read/list/write, ids, the write lock, claims and events. These still use
files directly and stay per-machine or need follow-up before cutover: evidence copying
(`evidence.mjs`), `plans.mjs`, `goal-import.mjs`, `agents.mjs`, `dispatch/pool.mjs`, `doctor.mjs`,
`dashboard-api.mjs`, `mcp.mjs` reads of `.file`, and `readEvents` (reads the local log).
