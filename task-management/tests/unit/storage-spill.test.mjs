/**
 * Large values: a field past storage.spillBytes leaves the envelope for the object store and comes
 * back byte-identical. Every test runs the same path with spilling OFF and must see the server's
 * MAX_PAYLOAD_EXCEEDED, so a green run proves the spill did the work (a body that was never big
 * would pass both ways, which the size asserts rule out).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { startHubLeaf, startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { decode, encode, isBlobRef } from "../../lib/storage/registry.mjs";
import { migrate } from "../../lib/storage/migrate.mjs";
import { cutover } from "../../lib/storage/cutover.mjs";
import { repoAliases, repoKey } from "../../lib/storage/index.mjs";
import { create, writeConfig } from "../../lib/store.mjs";
import "../../lib/storage/types.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const REAL = process.env.TM_SPILL_FIXTURE || "/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/177a0074-f13b-446a-92db-45e161f580ba/scratchpad/ao-sandbox/cutover-rehearsal/repo/.bytedesk/task-management/tasks/TM-217-agent-orchestration-reviewer-age-out-a-verdict-s.md";
// random text: incompressible and non-ASCII, so a lossy encoding would show
const fiveMB = () => randomBytes(3_700_000).toString("base64").slice(0, 5 * 1024 * 1024) + " — é ✓\n";
let srv, cache, boards = [];
const be = (o = {}) => new NatsBackend({ repo: `sp${Math.random().toString(16).slice(2, 8)}`, url: srv.url, cacheDir: mkdtempSync(join(tmpdir(), "tm-spc-")), ...o });

before(async () => {
  srv = await startServer();
  cache = mkdtempSync(join(tmpdir(), "tm-spill-cache-"));
  process.env.TM_CACHE_DIR = cache;
  delete process.env.TM_SPILL_BYTES;
});
after(async () => {
  await srv.cleanup();
  cleanup(cache, ...boards);
});

const roundTrip = async (label, body) => {
  const before_ = sha(body);
  console.log(`${label}: ${Buffer.byteLength(body)} bytes, sha256 before ${before_}`);
  assert.ok(Buffer.byteLength(body) > 1_048_576, "the body must exceed NATS max_payload or the test proves nothing");

  const off = be({ spillBytes: 0 });
  const err = await off.put("tm/task", "TM-1", encode("tm/task", { id: "TM-1", title: "t", body })).catch((e) => e);
  console.log(`${label}: spilling OFF ->`, err?.code ?? err?.name, err?.message);
  assert.match(String(err?.code ?? err?.message), /MAX_PAYLOAD_EXCEEDED/i);
  await off.close();

  const b = be();
  const { rev } = await b.put("tm/task", "TM-1", encode("tm/task", { id: "TM-1", title: "t", body }));
  const got = await b.get("tm/task", "TM-1");
  console.log(`${label}: spilling ON  -> rev ${rev}, sha256 after ${sha(got.envelope.data.body)}`);
  assert.equal(sha(got.envelope.data.body), before_);
  assert.equal(got.envelope.data.body, body);
  assert.equal(decode(got.envelope).data.body, body);

  // the stored value is small and carries a reference: a reader that does not know $blob sees it, not a truncation
  const raw = await b.h.entities.get(`${b.repo}.tm/task.TM-1`);
  const stored = JSON.parse(new TextDecoder().decode(raw.value));
  console.log(`${label}: stored value ${raw.value.length} bytes, body field =`, JSON.stringify(stored.data.body));
  assert.ok(raw.value.length < 2000);
  assert.ok(isBlobRef(stored.data.body));
  assert.equal(stored.data.body.$blob.encoding, "json");
  assert.equal(decode(stored).data.body.$blob.digest, stored.data.body.$blob.digest, "sync decode leaves the reference untouched");

  // history, list, and an unchanged re-put (same blob, no second upload)
  const blobsBefore = (await b.blobList()).length;
  await b.put("tm/task", "TM-1", encode("tm/task", { id: "TM-1", title: "t2", body }));
  assert.equal((await b.blobList()).length, blobsBefore, "same body → same blob");
  const hist = await b.history("tm/task", "TM-1");
  console.log(`${label}: history`, JSON.stringify(hist.map((h) => [h.rev, h.envelope.data.title, sha(h.envelope.data.body).slice(0, 12)])));
  assert.equal(hist.length, 2);
  assert.ok(hist.every((h) => h.envelope.data.body === body));
  assert.equal((await b.list("tm/task"))[0].envelope.data.body, body);

  // a fresh process with an empty cache fetches the blob from the server
  const fresh = new NatsBackend({ repo: b.repo, url: srv.url, cacheDir: mkdtempSync(join(tmpdir(), "tm-spc-")) });
  assert.equal(sha((await fresh.get("tm/task", "TM-1")).envelope.data.body), before_);
  // a missing blob is an error, never a silent short value
  await b.h.evidence.delete(`${b.repo}/${stored.data.body.$blob.digest}`);
  const gone = new NatsBackend({ repo: b.repo, url: srv.url, cacheDir: mkdtempSync(join(tmpdir(), "tm-spc-")) });
  await assert.rejects(gone.get("tm/task", "TM-1"), /not available/);
  await b.close(); await fresh.close(); await gone.close();
};

describe("spill: entities", () => {
  it("synthetic 5 MB body: put/get/history round-trip is byte-identical; fails with spilling off", () => roundTrip("synthetic 5MB", fiveMB()));
  it("copy of the real TM-217 file (3.2 MB): byte-identical; fails with spilling off", async (t) => {
    if (!existsSync(REAL)) return t.skip(`SKIPPED, not run: ${REAL} is absent (set TM_SPILL_FIXTURE)`);
    await roundTrip("real TM-217", readFileSync(REAL, "utf8"));
  });
  it("a threshold is honoured: small fields stay inline, only the large one spills", async () => {
    const b = be({ spillBytes: 1000 });
    await b.put("tm/task", "TM-2", encode("tm/task", { id: "TM-2", title: "small", body: "x".repeat(5000), note: "tiny" }));
    const raw = JSON.parse(new TextDecoder().decode((await b.h.entities.get(`${b.repo}.tm/task.TM-2`)).value));
    console.log("threshold 1000:", JSON.stringify({ title: raw.data.title, note: raw.data.note, body: raw.data.body }));
    assert.equal(raw.data.note, "tiny");
    assert.ok(isBlobRef(raw.data.body));
    await b.close();
  });
});

describe("spill: events, offline queue, leaf", () => {
  it("an event with a 2 MB field is stored by reference and paged back whole; fails with spilling off", async () => {
    const note = randomBytes(1_500_000).toString("base64");
    const off = be({ spillBytes: 0 });
    const err = await off.appendEvent({ event: "big", note }).catch((e) => e);
    console.log("event, spilling OFF ->", err?.code ?? err?.name, err?.message);
    assert.match(String(err?.code ?? err?.message), /MAX_PAYLOAD_EXCEEDED/i);
    const b = be();
    await b.appendEvent({ event: "big", note });
    const rows = await b.events({ filter: "big" });
    console.log("event round trip: rows", rows.length, "sha before", sha(note).slice(0, 16), "after", sha(rows[0].note).slice(0, 16));
    assert.equal(rows[0].note, note);
    await off.close(); await b.close();
  });

  it("offline: a big write queues by reference (blob in the local cache) and replays whole on reconnect", async () => {
    const body = fiveMB();
    const cacheDir = mkdtempSync(join(tmpdir(), "tm-spq-"));
    const repo = "spoff1";
    const dead = new NatsBackend({ repo, url: "nats://127.0.0.1:1", cacheDir, retryMs: 0 });
    const r = await dead.put("tm/task", "TM-9", encode("tm/task", { id: "TM-9", title: "queued", body }));
    const q = readFileSync(join(cacheDir, "queue.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.op === "put");
    console.log("queued:", JSON.stringify(r), "| queue line bytes", JSON.stringify(q).length, "| body =", JSON.stringify(q.payload.data.body));
    assert.equal(r.queued, true);
    assert.ok(JSON.stringify(q).length < 2000);
    const live = new NatsBackend({ repo, url: srv.url, cacheDir });
    const got = await live.get("tm/task", "TM-9");
    console.log("after replay: sha before", sha(body).slice(0, 16), "after", sha(got.envelope.data.body).slice(0, 16));
    assert.equal(got.envelope.data.body, body);
    await live.close();
  });

  it("leaf: hub down, the leaf mirror still serves the spilled entity whole (blob cached on the leaf)", async () => {
    const net = await startHubLeaf();
    try {
      const body = fiveMB();
      const mk = (o = {}) => new NatsBackend({ repo: "spl1", url: net.leaf.url, domain: "hub", cacheDir: mkdtempSync(join(tmpdir(), "tm-spl-")), retryMs: 0, probeMs: 0, ...o });
      const w = mk();
      for (let i = 0; i < 60 && (await w.info()).offline; i += 1) await new Promise((r) => setTimeout(r, 200));
      await w.put("tm/task", "TM-5", encode("tm/task", { id: "TM-5", title: "leaf", body }));
      assert.equal((await w.get("tm/task", "TM-5")).envelope.data.body, body); // online read: fills the leaf's object store
      await w.close();
      await net.hub.stop();
      const r = mk(); // empty file cache: whatever it reads comes from the leaf's JetStream
      let got = null;
      for (let i = 0; i < 40 && !got; i += 1) { try { got = await r.get("tm/task", "TM-5"); } catch { await new Promise((x) => setTimeout(x, 250)); } }
      console.log("leaf tier:", (await r.info()).lastReadTier, "| sha before", sha(body).slice(0, 16), "after", got && sha(got.envelope.data.body).slice(0, 16));
      assert.equal((await r.info()).lastReadTier, "leaf");
      assert.equal(got.envelope.data.body, body);
      await r.close();
    } finally {
      net.hub = await net.hub.restart(); // stop() of an already-killed server never resolves; give cleanup a live one
      await net.cleanup();
    }
  });
});

describe("spill: migrate", () => {
  it("a board with a 5 MB body migrates with equal counts and a second run writes nothing; fails with spilling off", async () => {
    const p = tempStore();
    boards.push(p.root);
    writeConfig({ enforce: false, requireEpic: false, requireAcceptance: false }, p);
    const e = create("epic", { title: "e" }, "e", p);
    for (let i = 1; i <= 4; i += 1) create("task", { title: `t${i}`, epic: e.id }, i === 2 ? fiveMB() : `body ${i}\n`, p);
    const mkb = (o) => new NatsBackend({ repo: repoKey(p), aliases: repoAliases(p), url: srv.url, ...o });
    await assert.rejects(migrate({ backend: mkb({ spillBytes: 0, repo: "offmig" }), p, events: false }), /MAX_PAYLOAD_EXCEEDED/i);
    const b = mkb();
    const r1 = await migrate({ backend: b, p });
    const r2 = await migrate({ backend: b, p });
    const row = (r) => JSON.stringify(Object.fromEntries(Object.entries(r.types).filter(([t]) => t === "tm/task" || t === "tm/epic").map(([t, v]) => [t, { source: v.source, dest: v.dest, written: v.written, skipped: v.skipped, equal: v.equal }])));
    console.log("run 1", row(r1), "ok", r1.ok, "\nrun 2", row(r2), "ok", r2.ok);
    assert.ok(r1.ok && r2.ok);
    assert.equal(r1.types["tm/task"].source, 4);
    assert.equal(r1.types["tm/task"].dest, 4);
    assert.equal(r2.types["tm/task"].written, 0);
    assert.equal(r2.events.published, 0);
    await b.close();
  });
});

describe("re-running a migration after cutover must not revert newer NATS writes", () => {
  const fresh = () => {
    const p = tempStore();
    boards.push(p.root);
    writeConfig({ enforce: false, requireEpic: false, requireAcceptance: false }, p);
    const e = create("epic", { title: "e" }, "e", p);
    create("task", { title: "t1", epic: e.id }, "original body\n", p);
    return p;
  };
  it("migrate keeps a task that tm edited in NATS after the import (diverged), and reports it", async () => {
    const p = fresh();
    const b = new NatsBackend({ repo: repoKey(p), aliases: repoAliases(p), url: srv.url });
    await migrate({ backend: b, p, events: false });
    const cur = await b.get("tm/task", "TM-001");
    await b.put("tm/task", "TM-001", encode("tm/task", { ...cur.envelope.data, body: "edited in NATS after cutover\n" }, { src: "tm" }), { ifRev: cur.rev });
    const r = await migrate({ backend: b, p, events: false });
    const after = (await b.get("tm/task", "TM-001")).envelope.data.body;
    console.log("re-run:", JSON.stringify({ written: r.types["tm/task"].written, diverged: r.types["tm/task"].diverged, ok: r.ok }), "| NATS body =", JSON.stringify(after));
    assert.equal(after, "edited in NATS after cutover\n", "the markdown source is older: it must not win");
    assert.equal(r.types["tm/task"].diverged, 1);
    assert.equal(r.types["tm/task"].written, 0);
    assert.ok(r.ok);
    await b.close();
  });
  it("cutover on a board already on nats migrates nothing and writes nothing", async () => {
    const p = fresh();
    writeConfig({ storage: { backend: "nats" } }, p);
    const b = new NatsBackend({ repo: repoKey(p), aliases: repoAliases(p), url: srv.url });
    const v = await cutover({ backend: b, p });
    console.log("second cutover:", JSON.stringify({ alreadySwitched: v.alreadySwitched, types: v.types }), "| tasks on the server:", (await b.list("tm/task")).length);
    assert.equal(v.alreadySwitched, true);
    assert.equal((await b.list("tm/task")).length, 0);
    await b.close();
  });
});
