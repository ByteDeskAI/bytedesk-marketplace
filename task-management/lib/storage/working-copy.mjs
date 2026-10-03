/**
 * Plans and evidence are files people open, edit and attach from disk. With the NATS backend the
 * source of truth is the backend (tm/plan entities, content-addressed evidence blobs) and the
 * files under plans/ and evidence/ are a local working copy:
 *
 *   push*  on capture/attach — send the bytes to the backend;
 *   pull*  before a read — write any file that is missing locally from the backend.
 *
 * Every function is a no-op on the file backend, so default behaviour is untouched.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { remote } from "./index.mjs";

export function pushPlan(p, name, text) {
  const rb = remote(p);
  if (!rb) return;
  rb.call("put", "tm/plan", name, { type: "tm/plan", schema: 1, id: name, data: { id: name, name, text }, meta: {} });
}

export function pullPlans(p) {
  const rb = remote(p);
  if (!rb || !p.plans) return;
  let rows;
  try {
    rows = rb.call("list", "tm/plan");
  } catch {
    return; // offline: whatever is already on disk
  }
  for (const { envelope } of rows) {
    const f = join(p.plans, envelope.id);
    if (existsSync(f)) continue;
    mkdirSync(p.plans, { recursive: true });
    writeFileSync(f, envelope.data.text ?? "");
  }
}

export function pushBlob(p, buf) {
  const rb = remote(p);
  return rb ? rb.call("blobPut", buf) : null;
}

/** Recreate an attached evidence file from its blob when the working copy is gone. Returns true if it did. */
export function pullEvidence(entity, ref, provenanceKey, p) {
  const rb = remote(p);
  if (!rb || !entity) return false;
  const target = isAbsolute(ref) ? ref : join(p.root, ref);
  if (existsSync(target)) return false;
  const sha = entity[provenanceKey]?.[ref]?.sha256;
  if (!sha) return false;
  let buf;
  try {
    buf = rb.call("blobGet", sha);
  } catch {
    return false;
  }
  if (!buf) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(buf));
  return true;
}
