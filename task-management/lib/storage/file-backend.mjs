/**
 * The current markdown store behind the Backend interface. Every write goes through store.mjs's
 * own write()/logEvent(), so the guards (board identity, governed mutation, tool-call markup)
 * behave exactly as before. Kept as the importer's source and as a test double.
 *
 * Schema: files carry no schema field, so they read as schema 0 (legacy) unless the frontmatter
 * has `_schema` (only ever present if something wrote a higher one — then it is read-only).
 * tm/plan: each file in plans/ is a plan, id = file name, data = {id, name, text}.
 * Not supported here, and says so: history (git has it), stateGet/Put/... (state.json is
 * handled by store.mjs itself, under its file lock).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../paths.mjs";
import { Backend, ConflictError, UnsupportedError } from "./backend.mjs";
import { assertWritable } from "./registry.mjs";
import { kindOfType } from "./types.mjs";

const ENTITY = new Set(["tm/task", "tm/epic", "tm/adr", "tm/sprint", "tm/capability"]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

export class FileBackend extends Backend {
  constructor(p = paths()) {
    super();
    this.p = { ...p, forceFile: true }; // a FileBackend is the markdown store whatever TM_STORAGE says
  }
  get kind() {
    return "file";
  }
  async #store() {
    return import("../store.mjs"); // lazy: store.mjs imports the storage selector
  }
  #check(type, op) {
    if (!ENTITY.has(type)) throw new UnsupportedError("file", `${op} on ${type}`);
    return kindOfType(type);
  }
  #envelope(type, doc) {
    const { file, ...data } = doc;
    const schema = Number.isInteger(data._schema) ? data._schema : 0;
    delete data._schema;
    const text = readFileSync(file, "utf8");
    const rev = createHash("sha1").update(text).digest("hex");
    return { envelope: { type, schema, id: data.id, data, meta: { src: "tm", rev, ts: new Date(statSync(file).mtimeMs).toISOString() } }, rev, file };
  }

  // ── plans: plain files, no frontmatter ──
  #planFile(id) {
    if (!id || id.includes("/") || id.startsWith(".")) throw new Error(`bad plan id: ${id}`);
    return join(this.p.plans, id);
  }
  #planEntry(id) {
    const f = this.#planFile(id);
    if (!existsSync(f)) return null;
    const text = readFileSync(f, "utf8");
    const rev = createHash("sha1").update(text).digest("hex");
    return { envelope: { type: "tm/plan", schema: 0, id, data: { id, name: id, text }, meta: { src: "tm", rev } }, rev };
  }
  async #planPut(id, envelope, { ifRev } = {}, mustCreate = false) {
    const cur = this.#planEntry(id);
    if (mustCreate && cur) throw new ConflictError(`tm/plan ${id} already exists`, cur.rev);
    if (ifRev !== undefined && (cur?.rev ?? null) !== ifRev) throw new ConflictError(`tm/plan ${id} changed`, cur?.rev ?? null);
    mkdirSync(this.p.plans, { recursive: true });
    const { writeAtomic } = await this.#store();
    writeAtomic(this.#planFile(id), envelope.data.text ?? "");
    return { rev: this.#planEntry(id).rev };
  }

  async get(type, id) {
    if (type === "tm/plan") return this.#planEntry(id);
    this.#check(type, "get");
    const s = await this.#store();
    const doc = s.read(id, this.p);
    return doc ? this.#envelope(type, doc) : null;
  }

  async #write(type, id, envelope, { ifRev, reason } = {}, mustCreate = false) {
    this.#check(type, "put");
    const s = await this.#store();
    return s.withLock(this.p, () => {
      const cur = s.read(id, this.p);
      const stored = cur ? this.#envelope(type, cur) : null;
      if (mustCreate && stored) throw new ConflictError(`${type} ${id} already exists`, stored.rev);
      if (stored) assertWritable(stored.envelope);
      if (ifRev !== undefined && (stored?.rev ?? null) !== ifRev) throw new ConflictError(`${type} ${id} changed`, stored?.rev ?? null);
      const { body = "", ...data } = envelope.data;
      const written = s.write({ ...data, body, file: stored?.file }, this.p);
      return { rev: this.#envelope(type, s.read(written.id, this.p)).rev };
    });
  }
  put(type, id, envelope, opts) {
    if (type === "tm/plan") return this.#planPut(id, envelope, opts);
    return this.#write(type, id, envelope, opts);
  }
  create(type, id, envelope) {
    if (type === "tm/plan") return this.#planPut(id, envelope, {}, true);
    return this.#write(type, id, envelope, {}, true);
  }
  async delete(type, id, { ifRev, reason } = {}) {
    if (type === "tm/plan") {
      const cur = this.#planEntry(id);
      if (!cur) return false;
      if (ifRev !== undefined && cur.rev !== ifRev) throw new ConflictError(`tm/plan ${id} changed`, cur.rev);
      unlinkSync(this.#planFile(id));
      return true;
    }
    const cur = await this.get(type, id);
    if (!cur) return false;
    await this.put(type, id, { ...cur.envelope, data: { ...cur.envelope.data, status: "deleted" } }, { ifRev, reason });
    return true;
  }

  async list(type, { prefix = "" } = {}) {
    if (type === "tm/plan") {
      if (!existsSync(this.p.plans)) return [];
      return readdirSync(this.p.plans)
        .filter((n) => !n.startsWith(".") && !n.endsWith(".tmp") && n.startsWith(prefix) && statSync(join(this.p.plans, n)).isFile())
        .sort()
        .map((n) => this.#planEntry(n));
    }
    const kind = this.#check(type, "list");
    const s = await this.#store();
    return s
      .list(kind, { includeDeleted: true }, this.p)
      .filter((d) => d.id.startsWith(prefix))
      .map((d) => this.#envelope(type, d));
  }

  /** ponytail: polling diff, 250ms. NATS KV watch is the real one; this is the test double. */
  async *watch(type, { since, intervalMs = 250, signal } = {}) {
    let seen = new Map((await this.list(type)).map((e) => [e.envelope.id, e.rev]));
    while (!signal?.aborted) {
      await new Promise((r) => setTimeout(r, intervalMs));
      for (const e of await this.list(type)) {
        if (seen.get(e.envelope.id) !== e.rev) {
          seen.set(e.envelope.id, e.rev);
          yield { type, id: e.envelope.id, op: "put", rev: e.rev, envelope: e.envelope };
        }
      }
    }
  }

  // Evidence blobs: content-addressed under evidence/.blobs/<sha256>.
  async blobPut(input) {
    const buf = Buffer.isBuffer(input) ? input : typeof input === "string" ? Buffer.from(input) : Buffer.concat(await collect(input));
    const digest = sha(buf);
    const dir = join(this.p.evidence, ".blobs");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, digest);
    if (!existsSync(f)) writeFileSync(f, buf);
    return digest;
  }
  async blobGet(digest) {
    const f = join(this.p.evidence, ".blobs", digest);
    return existsSync(f) ? readFileSync(f) : null;
  }
  async blobList() {
    const dir = join(this.p.evidence, ".blobs");
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  async appendEvent(event) {
    const { event: name, kind, ...rest } = event;
    (await this.#store()).logEvent(name || kind, rest, this.p);
  }
  async events({ since, filter } = {}) {
    let rows = (await this.#store()).readEvents(this.p);
    if (since) rows = rows.filter((r) => String(r.ts) > String(since));
    if (filter) rows = rows.filter((r) => r.event === filter);
    return rows;
  }
  async info() {
    return { kind: "file", server: this.p.base, offline: false };
  }
}

async function collect(iter) {
  const out = [];
  for await (const c of iter) out.push(Buffer.from(c));
  return out;
}
