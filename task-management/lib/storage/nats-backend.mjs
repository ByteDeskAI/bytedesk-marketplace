/**
 * NATS JetStream backend (CONTRACT §3, §5, §6).
 *
 *   KV  TM_ENTITIES   <repo>.<type>.<id>              history 64, CAS via revision
 *   KV  TM_PROPOSALS  <repo>.<type>.<id>.<proposal>   writes that were queued offline
 *   KV  TM_STATE      <repo>.claims.<task> | <repo>.session.<sid> | <repo>.lock   (replaces state.lock)
 *   STR TM_EVENTS     tm.<repo>.events.<kind>         limits, max_age 3650d
 *   OBJ TM_EVIDENCE   <repo>/<sha256>
 *
 * Connection: URL from opts.url or TM_NATS_URL, creds from opts.creds or TM_NATS_CREDS. The ambient
 * NATS_URL is never read (ADR-0032) — a stray variable must not point the board at another server.
 *
 * Offline (leaf node down / unreachable): connect fails fast. Reads come from the local cache that
 * every successful read refreshes; writes append to a local queue as proposals and replay on the
 * next connection, same proposal id, so a replay twice is a no-op. The caller is told once via
 * `onOffline` ("offline: read-only, writes queued"). Claims and the lease need a live CAS and are
 * refused offline rather than faked.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Backend, ConflictError, OfflineError, UnsupportedError } from "./backend.mjs";
import { assertWritable, decode } from "./registry.mjs";

export const OFFLINE_MESSAGE = "offline: read-only, writes queued";
const DAY_NS = 24 * 3600 * 1e9;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const safe = (s) => String(s).replace(/[^A-Za-z0-9_\-=]/g, "_");
const enc = (v) => new TextEncoder().encode(JSON.stringify(v));
const dec = (u8) => JSON.parse(new TextDecoder().decode(u8));

export class NatsBackend extends Backend {
  /**
   * @param {object} o  repo (required key prefix), cacheDir (local cache + queue), url, creds,
   *   connectTimeoutMs, onOffline(msg), actor() -> {actor, agent}, root (for git meta)
   */
  constructor(o = {}) {
    super();
    this.o = o;
    this.repo = o.repo;
    if (!this.repo) throw new Error("NatsBackend needs a repo key");
    this.cacheDir = o.cacheDir;
    this.offline = false;
    this.told = false;
    this.nc = null;
    this.h = null;
  }
  get kind() {
    return "nats";
  }

  // ── connection ─────────────────────────────────────────────────────────────
  async #ready() {
    if (this.h && this.h.nc.isClosed()) this.h = null; // the server went away under a live handle
    if (this.h) return this.h;
    // Fail fast: once a connect has failed, do not pay the connect timeout again on every call.
    if (this.offline && Date.now() - this.lastFail < (this.o.retryMs ?? 10_000)) return null;
    const url = this.o.url ?? process.env.TM_NATS_URL;
    if (!url) {
      this.#goOffline("TM_NATS_URL is not set");
      return null;
    }
    try {
      const { connect, credsAuthenticator } = await import("nats");
      const credsFile = this.o.creds ?? process.env.TM_NATS_CREDS;
      const nc = await connect({
        servers: url,
        timeout: this.o.connectTimeoutMs ?? 1500,
        reconnect: this.o.reconnect ?? false,
        maxReconnectAttempts: 0,
        ...(credsFile ? { authenticator: credsAuthenticator(readFileSync(credsFile)) } : {}),
      });
      const js = nc.jetstream();
      const jsm = await nc.jetstreamManager();
      const kv = async (name, opts) => js.views.kv(name, opts);
      this.h = {
        nc, js, jsm, url,
        entities: await kv("TM_ENTITIES", { history: 64 }),
        proposals: await kv("TM_PROPOSALS", { history: 8 }),
        state: await kv("TM_STATE", { history: 8 }),
        evidence: await js.views.os("TM_EVIDENCE"),
      };
      try {
        await jsm.streams.info("TM_EVENTS");
      } catch {
        await jsm.streams.add({ name: "TM_EVENTS", subjects: ["tm.*.events.>"], retention: "limits", storage: "file", max_age: 3650 * DAY_NS });
      }
      this.offline = false;
      this.told = false;
      await this.#replay();
      return this.h;
    } catch (err) {
      if (err instanceof OfflineError) throw err;
      this.#goOffline(err.message);
      return null;
    }
  }
  #goOffline(why) {
    this.offline = true;
    this.why = why;
    this.lastFail = Date.now();
    if (!this.told) {
      this.told = true;
      this.o.onOffline?.(OFFLINE_MESSAGE, why);
    }
  }
  async close() {
    if (this.h) await this.h.nc.drain().catch(() => {});
    this.h = null;
  }
  async info() {
    const h = await this.#ready();
    return { kind: "nats", server: h?.url ?? this.o.url ?? process.env.TM_NATS_URL ?? null, offline: !h, why: h ? undefined : this.why, queued: this.queue().length };
  }

  // ── keys & meta ────────────────────────────────────────────────────────────
  key(type, id) { return `${this.repo}.${type}.${safe(id)}`; }
  #meta(extra = {}) {
    const who = (typeof this.o.actor === "function" ? this.o.actor() : this.o.actor) ?? {};
    this.commit ??= (() => {
      try {
        return execFileSync("git", ["-C", this.o.root || process.cwd(), "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return null;
      }
    })();
    return { actor: who.actor ?? null, agent: who.agent ?? null, ts: new Date().toISOString(), src: "tm", git: { commit: this.commit, pr: null }, ...extra };
  }
  #entry(type, e) {
    const envelope = dec(e.value);
    envelope.meta = { ...envelope.meta, rev: e.revision };
    return { envelope, rev: e.revision };
  }

  // ── local cache + queue (leaf-node offline) ────────────────────────────────
  #cacheFile(type, id) { return join(this.cacheDir, "entities", safe(type), `${safe(id)}.json`); }
  #cacheSet(type, id, v) {
    if (!this.cacheDir) return;
    try {
      const f = this.#cacheFile(type, id);
      mkdirSync(join(f, ".."), { recursive: true });
      writeFileSync(f, JSON.stringify(v));
    } catch { /* a cache failure must not fail a read */ }
  }
  #cacheGet(type, id) {
    try { return JSON.parse(readFileSync(this.#cacheFile(type, id), "utf8")); } catch { return null; }
  }
  #cacheList(type) {
    if (!this.cacheDir) return [];
    const dir = join(this.cacheDir, "entities", safe(type));
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  get queueFile() { return this.cacheDir && join(this.cacheDir, "queue.jsonl"); }
  queue() {
    if (!this.queueFile || !existsSync(this.queueFile)) return [];
    return readFileSync(this.queueFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  #enqueue(rec) {
    if (!this.queueFile) throw new OfflineError("offline and no local cache configured — write refused");
    const id = sha(JSON.stringify({ op: rec.op, type: rec.type, id: rec.id, ifRev: rec.ifRev ?? null, payload: rec.payload })).slice(0, 16);
    const full = { ...rec, proposalId: id, queuedAt: new Date().toISOString() };
    mkdirSync(this.cacheDir, { recursive: true });
    if (!this.queue().some((q) => q.proposalId === id)) appendFileSync(this.queueFile, `${JSON.stringify(full)}\n`);
    return { rev: null, queued: true, proposalId: id };
  }

  /** Replay queued proposals. Idempotent: the proposal key is the dedupe, and an applied one is skipped. */
  async #replay() {
    const q = this.queue();
    if (!q.length) return [];
    const done = [];
    for (const rec of q) {
      const pkey = `${this.repo}.${rec.type}.${safe(rec.id)}.${rec.proposalId}`;
      let status = "applied";
      try {
        await this.h.proposals.create(pkey, enc({ ...rec, status: "pending" }));
      } catch (err) {
        const prior = await this.h.proposals.get(pkey);
        if (prior?.value?.length && dec(prior.value).status !== "pending") { done.push({ ...rec, status: dec(prior.value).status, replayed: false }); continue; }
      }
      try {
        if (rec.op === "event") await this.h.js.publish(`tm.${this.repo}.events.${safe(rec.payload.event || rec.payload.kind || "event")}`, enc(rec.payload), { msgID: rec.proposalId });
        else if (rec.op === "put" || rec.op === "create") await this.#putOnline(rec.type, rec.id, rec.payload, { ifRev: rec.ifRev ?? undefined, reason: rec.reason }, rec.op === "create");
        else if (rec.op === "delete") await this.#deleteOnline(rec.type, rec.id, { ifRev: rec.ifRev ?? undefined, reason: rec.reason });
      } catch (err) {
        status = err instanceof ConflictError ? "conflict" : "failed";
        rec.detail = err.message;
      }
      await this.h.proposals.put(pkey, enc({ ...rec, status }));
      done.push({ ...rec, status, replayed: true });
    }
    writeFileSync(this.queueFile, "");
    this.replayed = done;
    return done;
  }

  // ── entities ───────────────────────────────────────────────────────────────
  async #stored(type, id) {
    const e = await this.h.entities.get(this.key(type, id));
    return e && e.operation === "PUT" ? this.#entry(type, e) : null;
  }
  async get(type, id) {
    const h = await this.#ready();
    if (!h) return this.#cacheGet(type, id);
    const hit = await this.#stored(type, id);
    if (hit) this.#cacheSet(type, id, hit);
    return hit;
  }
  async list(type, { prefix = "" } = {}) {
    const h = await this.#ready();
    if (!h) return this.#cacheList(type).filter((e) => e.envelope.id.startsWith(prefix));
    const out = [];
    const keys = await h.entities.keys(`${this.repo}.${type}.>`);
    const names = [];
    for await (const k of keys) names.push(k);
    for (const k of names) {
      const e = await h.entities.get(k);
      if (!e || e.operation !== "PUT") continue;
      const hit = this.#entry(type, e);
      if (!hit.envelope.id.startsWith(prefix)) continue;
      this.#cacheSet(type, hit.envelope.id, hit);
      out.push(hit);
    }
    return out.sort((a, b) => String(a.envelope.id).localeCompare(String(b.envelope.id)));
  }

  async #putOnline(type, id, envelope, { ifRev, reason } = {}, mustCreate = false) {
    const key = this.key(type, id);
    const body = (rev) => enc({ ...envelope, id, meta: { ...this.#meta({ reason }), ...envelope.meta, rev: undefined, reason: reason ?? envelope.meta?.reason } });
    for (let attempt = 0; ; attempt += 1) {
      const cur = await this.#stored(type, id);
      if (cur) assertWritable(cur.envelope);
      if (mustCreate && cur) throw new ConflictError(`${type} ${id} already exists`, cur.rev);
      if (ifRev !== undefined && (cur?.rev ?? null) !== ifRev) throw new ConflictError(`${type} ${id} changed since rev ${ifRev}`, cur?.rev ?? null);
      try {
        const rev = cur ? await this.h.entities.update(key, body(), cur.rev) : await this.h.entities.create(key, body());
        const hit = { envelope: { ...envelope, meta: { ...envelope.meta, rev } }, rev };
        this.#cacheSet(type, id, hit);
        return { rev };
      } catch (err) {
        if (!/wrong last sequence|key exists/i.test(String(err.message))) throw err;
        // Someone else landed between our read and write. An explicit ifRev is final; an
        // unconditional put retries on the fresh revision.
        if (ifRev !== undefined || mustCreate || attempt >= 4) {
          const now = await this.#stored(type, id);
          throw new ConflictError(`${type} ${id} changed under the write`, now?.rev ?? null);
        }
      }
    }
  }
  async put(type, id, envelope, opts = {}) {
    // Offline, the write is a proposal against the revision we last saw, so a change made elsewhere
    // meanwhile shows up as a conflict on replay instead of being silently overwritten.
    if (!(await this.#ready())) return this.#enqueue({ op: "put", type, id, ifRev: opts.ifRev ?? this.#cacheGet(type, id)?.rev, reason: opts.reason, payload: envelope });
    return this.#putOnline(type, id, envelope, opts);
  }
  async create(type, id, envelope) {
    if (!(await this.#ready())) return this.#enqueue({ op: "create", type, id, payload: envelope });
    return this.#putOnline(type, id, envelope, {}, true);
  }
  async #deleteOnline(type, id, { ifRev, reason } = {}) {
    const cur = await this.#stored(type, id);
    if (!cur) return false;
    assertWritable(cur.envelope);
    if (ifRev !== undefined && cur.rev !== ifRev) throw new ConflictError(`${type} ${id} changed since rev ${ifRev}`, cur.rev);
    try {
      await this.h.entities.delete(this.key(type, id), { previousSeq: cur.rev });
    } catch (err) {
      throw new ConflictError(`${type} ${id} changed under the delete`, (await this.#stored(type, id))?.rev ?? null);
    }
    return true;
  }
  async delete(type, id, opts = {}) {
    if (!(await this.#ready())) return this.#enqueue({ op: "delete", type, id, ifRev: opts.ifRev, reason: opts.reason });
    return this.#deleteOnline(type, id, opts);
  }

  async history(type, id, { limit = 64 } = {}) {
    const h = await this.#ready();
    if (!h) throw new OfflineError(`${OFFLINE_MESSAGE} — history needs the server`);
    const it = await h.entities.history({ key: this.key(type, id) });
    const rows = [];
    for await (const e of it) rows.push({ rev: e.revision, op: e.operation, ts: e.created, envelope: e.operation === "PUT" ? dec(e.value) : null });
    return rows.slice(-limit);
  }

  async *watch(type, { since } = {}) {
    const h = await this.#ready();
    if (!h) throw new OfflineError(`${OFFLINE_MESSAGE} — watch needs the server`);
    const w = await h.entities.watch({ key: `${this.repo}.${type}.>`, ...(since ? { resumeFromRevision: since } : { ignoreDeletes: false }) });
    try {
      for await (const e of w) {
        const id = e.key.split(".").slice(2).join(".");
        yield { type, id, op: e.operation, rev: e.revision, envelope: e.operation === "PUT" ? this.#entry(type, e).envelope : null };
      }
    } finally {
      w.stop();
    }
  }

  // ── blobs ──────────────────────────────────────────────────────────────────
  async blobPut(input) {
    const buf = Buffer.isBuffer(input) ? input : typeof input === "string" ? Buffer.from(input) : Buffer.concat(await (async () => { const o = []; for await (const c of input) o.push(Buffer.from(c)); return o; })());
    const digest = sha(buf);
    const h = await this.#ready();
    if (!h) {
      if (!this.cacheDir) throw new OfflineError("offline and no local cache — blob refused");
      mkdirSync(join(this.cacheDir, "blobs"), { recursive: true });
      writeFileSync(join(this.cacheDir, "blobs", digest), buf);
      this.#enqueue({ op: "blob", type: "tm/evidence", id: digest, payload: { digest } });
      return digest;
    }
    const name = `${this.repo}/${digest}`;
    if (!(await h.evidence.info(name))) await h.evidence.putBlob({ name }, new Uint8Array(buf));
    return digest;
  }
  async blobGet(digest) {
    const h = await this.#ready();
    if (!h) {
      const f = this.cacheDir && join(this.cacheDir, "blobs", digest);
      return f && existsSync(f) ? readFileSync(f) : null;
    }
    const u8 = await h.evidence.getBlob(`${this.repo}/${digest}`);
    return u8 ? Buffer.from(u8) : null;
  }
  async blobList() {
    const h = await this.#ready();
    if (!h) return [];
    return (await h.evidence.list()).filter((i) => i.name.startsWith(`${this.repo}/`) && !i.deleted).map((i) => i.name.slice(this.repo.length + 1)).sort();
  }

  // ── events ─────────────────────────────────────────────────────────────────
  async appendEvent(event) {
    const h = await this.#ready();
    const kind = safe(event.event || event.kind || "event");
    const row = { ts: new Date().toISOString(), ...event };
    const msgID = sha(JSON.stringify(row)).slice(0, 32);
    if (!h) return this.#enqueue({ op: "event", type: "tm/event", id: kind, payload: row });
    await h.js.publish(`tm.${this.repo}.events.${kind}`, enc(row), { msgID });
    return { id: msgID };
  }
  async events({ since, filter } = {}) {
    const h = await this.#ready();
    if (!h) throw new OfflineError(`${OFFLINE_MESSAGE} — event history needs the server`);
    const subject = `tm.${this.repo}.events.${filter ? safe(filter) : ">"}`;
    const info = await h.jsm.streams.info("TM_EVENTS", { subjects_filter: subject });
    const total = Object.values(info.state.subjects ?? {}).reduce((a, b) => a + b, 0);
    if (!total) return [];
    const c = await h.js.consumers.get("TM_EVENTS", { filter_subjects: [subject], ...(since ? { opt_start_time: new Date(since).toISOString() } : {}) });
    const rows = [];
    const it = await c.fetch({ max_messages: total, expires: 3000 });
    for await (const m of it) {
      rows.push(dec(m.data));
      if (rows.length >= total) break;
    }
    return rows;
  }

  // ── TM_STATE: claims, sessions, lease (CAS) ────────────────────────────────
  async #state() {
    const h = await this.#ready();
    if (!h) throw new OfflineError(`${OFFLINE_MESSAGE} — claims and the write lease need the server`);
    return h.state;
  }
  async stateGet(key) {
    const kv = await this.#state();
    const e = await kv.get(`${this.repo}.${key}`);
    return e && e.operation === "PUT" ? { value: dec(e.value), rev: e.revision } : null;
  }
  async statePut(key, value, { ifRev } = {}) {
    const kv = await this.#state();
    try {
      return ifRev === undefined ? await kv.put(`${this.repo}.${key}`, enc(value)) : await kv.update(`${this.repo}.${key}`, enc(value), ifRev);
    } catch (err) {
      if (!/wrong last sequence/i.test(String(err.message))) throw err;
      throw new ConflictError(`${key} changed since rev ${ifRev}`, (await this.stateGet(key))?.rev ?? null);
    }
  }
  async stateCreate(key, value) {
    const kv = await this.#state();
    try {
      return await kv.create(`${this.repo}.${key}`, enc(value));
    } catch (err) {
      if (!/wrong last sequence|key exists/i.test(String(err.message))) throw err;
      throw new ConflictError(`${key} already exists`, (await this.stateGet(key))?.rev ?? null);
    }
  }
  async stateDelete(key, { ifRev } = {}) {
    const kv = await this.#state();
    try {
      await kv.delete(`${this.repo}.${key}`, ifRev === undefined ? undefined : { previousSeq: ifRev });
      return true;
    } catch (err) {
      throw new ConflictError(`${key} changed since rev ${ifRev}`, (await this.stateGet(key))?.rev ?? null);
    }
  }
  async stateList(prefix = "") {
    const kv = await this.#state();
    const out = [];
    for await (const k of await kv.keys(`${this.repo}.${prefix ? `${prefix}.` : ""}>`)) {
      const e = await kv.get(k);
      if (e?.operation === "PUT") out.push({ key: k.slice(this.repo.length + 1), value: dec(e.value), rev: e.revision });
    }
    return out;
  }

  /**
   * The cross-process write lease that replaces state.lock: a TM_STATE key created with CAS, taken
   * over with CAS once its owner's ttl has passed. Returns the release function.
   */
  async acquireLease(owner, { ttlMs = 30_000, waitMs = 30_000 } = {}) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const mine = { owner, expires: Date.now() + ttlMs };
      try {
        const rev = await this.stateCreate("lock", mine);
        return () => this.stateDelete("lock", { ifRev: rev }).catch(() => {});
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
        const cur = await this.stateGet("lock");
        if (cur && cur.value.expires < Date.now()) {
          try {
            const rev = await this.statePut("lock", mine, { ifRev: cur.rev });
            return () => this.stateDelete("lock", { ifRev: rev }).catch(() => {});
          } catch { /* lost the takeover race; loop */ }
        }
      }
      if (Date.now() > deadline) throw new Error(`could not take the store lease within ${waitMs / 1000}s — held by ${(await this.stateGet("lock"))?.value?.owner}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}
