/**
 * `tm migrate` — copy the markdown board into the NATS backend, then prove both sides agree.
 *
 *   1. one `tm export` JSON snapshot of the source first (skipped on --dry-run: nothing is written);
 *   2. every entity and evidence file is encoded through the registry (a doc the registry rejects
 *      stops the run before any write);
 *   3. --dry-run stops there and reports source vs planned vs already-on-destination counts;
 *   4. a real run writes (create, or put only when the stored data differs — safe to re-run),
 *      then re-reads the destination and compares count AND content per type.
 * The source is never modified. Exit non-zero if any side disagrees.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { ENTITY_TYPES } from "./types.mjs";
import { eventId, eventRow } from "./nats-backend.mjs";
import { encode, decode } from "./registry.mjs";
import { FileBackend } from "./file-backend.mjs";
import { repoKey } from "./index.mjs";
import { exportStore } from "../export.mjs";

const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const f = join(dir, name);
    if (statSync(f).isDirectory()) yield* walk(f);
    else yield f;
  }
}

export async function migrate({ backend, p, dryRun = false, snapshotPath, log = () => {}, events = true }) {
  const src = new FileBackend({ ...p, forceFile: true });
  const report = { dryRun, snapshot: null, types: {}, evidence: {}, ok: true };

  // 1. snapshot (a dry run writes nothing anywhere)
  if (!dryRun) {
    const dir = snapshotPath ? null : join(process.env.TM_CACHE_DIR || join(homedir(), ".cache", "task-management"), repoKey(p));
    const file = snapshotPath || join(dir, `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, exportStore("json", { includeDone: true }, { ...p, forceFile: true }));
    report.snapshot = file;
    log(`snapshot: ${file}`);
  }

  // 2-4. entities
  for (const type of [...ENTITY_TYPES, "tm/plan"]) {
    const rows = await src.list(type);
    const planned = rows.map((r) => encode(type, r.envelope.data, { src: "import" })); // throws before any write
    const t = (report.types[type] = { source: rows.length, planned: planned.length, destBefore: (await backend.list(type)).length, written: 0, skipped: 0, diverged: 0, dest: null, equal: null });
    if (dryRun) continue;
    const diverged = new Set();
    for (const env of planned) {
      const cur = await backend.get(type, env.id);
      if (cur && same(decode(cur.envelope).data, env.data)) {
        t.skipped += 1;
        continue;
      }
      // The destination was written by tm after the import (meta.src is not "import"): it is newer than
      // the markdown source, which stopped being written at cutover. Overwriting it would revert real work.
      if (cur && cur.envelope.meta?.src !== "import") {
        t.diverged += 1;
        diverged.add(env.id);
        continue;
      }
      await backend.put(type, env.id, env, { reason: "tm migrate", ...(cur ? { ifRev: cur.rev } : {}) });
      t.written += 1;
    }
    const after = await backend.list(type);
    const byId = new Map(after.map((e) => [e.envelope.id, decode(e.envelope).data]));
    const mismatched = planned.filter((e) => !diverged.has(e.id) && (!byId.has(e.id) || !same(byId.get(e.id), e.data))).map((e) => e.id);
    t.dest = after.length;
    t.equal = after.length === rows.length && mismatched.length === 0;
    if (mismatched.length) t.mismatched = mismatched.slice(0, 10);
    if (!t.equal) report.ok = false;
  }

  // evidence files → content-addressed blobs + one manifest entity each
  const files = [];
  try {
    for (const f of walk(p.evidence)) files.push(f);
  } catch { /* no evidence dir */ }
  const digests = new Map();
  for (const f of files) {
    const buf = readFileSync(f);
    digests.set(createHash("sha256").update(buf).digest("hex"), { f, size: buf.length });
  }
  const ev = (report.evidence = { sourceFiles: files.length, sourceDistinct: digests.size, destBefore: (await backend.blobList()).length, dest: null, equal: null });
  if (!dryRun) {
    for (const [digest, { f, size }] of digests) {
      await backend.blobPut(readFileSync(f));
      const id = `ev-${digest.slice(0, 12)}`;
      const env = encode("tm/evidence", { id, path: relative(p.evidence, f), sha256: digest, size }, { src: "import" });
      if (!(await backend.get("tm/evidence", id))) await backend.put("tm/evidence", id, env, { reason: "tm migrate" });
    }
    const have = new Set(await backend.blobList());
    ev.dest = [...digests.keys()].filter((d) => have.has(d)).length;
    ev.equal = ev.dest === digests.size;
    if (!ev.equal) report.ok = false;
  }

  // Event history: each row gets a stable id (hash of the row) used as Nats-Msg-Id AND as the
  // already-there test, so a re-run publishes nothing the stream already holds. The 120s Msg-Id
  // window alone would not survive a re-run an hour later.
  if (events) {
    const rows = (await src.events()).map(eventRow);
    const ids = new Set(rows.map(eventId));
    const have = new Set((await backend.events()).map((r) => eventId(r)));
    const e = (report.events = { source: rows.length, sourceDistinct: ids.size, destBefore: have.size, published: 0, dest: null, equal: null });
    if (!dryRun) {
      const seen = new Set(have);
      for (const row of rows) {
        const id = eventId(row);
        if (seen.has(id)) continue;
        await backend.appendEvent(row);
        seen.add(id);
        e.published += 1;
      }
      const after = new Set((await backend.events()).map((r) => eventId(r)));
      e.streamCount = (await backend.events()).length;
      e.dest = [...ids].filter((i) => after.has(i)).length;
      e.equal = e.dest === ids.size;
      if (!e.equal) report.ok = false;
    }
  }
  return report;
}
